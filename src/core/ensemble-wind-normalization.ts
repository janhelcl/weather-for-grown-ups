import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import {
  summarizeWindVectorDistribution,
  windVectorSampleFromComponents,
  windVectorSampleFromSpeedDirection,
  type WindVectorSample,
} from "./ensemble-statistics.js";

const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const PARALLEL_COLLECTION_KEYS = ["series", "points", "samples"] as const;

interface PressureWindDescriptor {
  kind: "pressure_level";
  pressureLevelHpa: number;
}

interface FieldWindDescriptor {
  kind: "field";
  field: string;
}

type WindDescriptor = PressureWindDescriptor | FieldWindDescriptor;

interface WindEvidence {
  descriptor: WindDescriptor;
  sample: WindVectorSample;
}

export function queryRequestsEnsembleWindSummary(request: QueryAtmosphereRequest): boolean {
  if (request.geometry.type === "area") return false;

  const variables = new Set(request.selection.variables ?? []);
  const hasPressureWind = variables.has("wind")
    || (variables.has("u_wind") && variables.has("v_wind"));
  if (hasPressureWind) return true;

  const fields = new Set(request.selection.fields ?? []);
  for (const field of fields) {
    if (/^wind_\d+m$/.test(field)) return true;
    const uMatch = field.match(/^u_wind_(\d+)m$/);
    if (uMatch?.[1] !== undefined && fields.has(`v_wind_${uMatch[1]}m`)) return true;
  }
  return false;
}

export function requestWithEnsembleWindMembers(
  request: QueryAtmosphereRequest,
): QueryAtmosphereRequest {
  return {
    ...request,
    ensemble: {
      ...(request.ensemble ?? {}),
      includeMembers: true,
    },
  };
}

export function normalizeEnsembleWindResult(
  request: QueryAtmosphereRequest,
  result: unknown,
): unknown {
  if (!isRecord(result)) return result;
  const quantiles = request.ensemble?.quantiles ?? DEFAULT_QUANTILES;
  augmentNestedMemberPayloads(result, quantiles);
  if (request.ensemble?.includeMembers !== true) stripMemberPayloads(result);
  return result;
}

function augmentNestedMemberPayloads(
  node: Record<string, unknown>,
  quantiles: readonly number[],
): void {
  const members = node.members;
  if (isMemberPayloadArray(members)) {
    augmentParallelResult(node, members, quantiles);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "members") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) augmentNestedMemberPayloads(item, quantiles);
      }
    } else if (isRecord(value)) {
      augmentNestedMemberPayloads(value, quantiles);
    }
  }
}

function augmentParallelResult(
  target: Record<string, unknown>,
  memberStates: readonly Record<string, unknown>[],
  quantiles: readonly number[],
): void {
  const summaries = summarizeMemberStates(memberStates, quantiles);
  if (summaries.length > 0) target.windVectorSummaries = summaries;

  for (const key of PARALLEL_COLLECTION_KEYS) {
    const targetCollection = target[key];
    if (!Array.isArray(targetCollection)) continue;
    const memberCollections = memberStates.map((member) => member[key]);
    if (!memberCollections.every(Array.isArray)) continue;
    if (!memberCollections.every((collection) => collection.length === targetCollection.length)) {
      throw new Error(`Ensemble wind normalization found inconsistent ${key} lengths across members`);
    }
    for (let index = 0; index < targetCollection.length; index += 1) {
      const targetItem = targetCollection[index];
      if (!isRecord(targetItem)) continue;
      const parallelStates = memberCollections.map((collection) => collection[index]);
      if (!parallelStates.every(isRecord)) continue;
      augmentParallelResult(
        targetItem,
        parallelStates as Record<string, unknown>[],
        quantiles,
      );
    }
  }
}

function summarizeMemberStates(
  memberStates: readonly Record<string, unknown>[],
  quantiles: readonly number[],
) {
  if (memberStates.length < 2) return [];
  const evidenceByMember = memberStates.map(extractWindEvidence);
  const keys = new Set(evidenceByMember.flatMap((evidence) => [...evidence.keys()]));
  const summaries = [];

  for (const key of keys) {
    const evidence = evidenceByMember.map((member) => member.get(key));
    const present = evidence.filter((candidate): candidate is WindEvidence => candidate !== undefined);
    if (present.length !== memberStates.length) {
      throw new Error(`Ensemble wind normalization found inconsistent member evidence for ${key}`);
    }
    const descriptor = present[0]!.descriptor;
    summaries.push({
      ...descriptor,
      ...summarizeWindVectorDistribution(
        present.map((candidate) => candidate.sample),
        quantiles,
      ),
    });
  }
  return summaries;
}

function extractWindEvidence(state: Record<string, unknown>): Map<string, WindEvidence> {
  const evidence = new Map<string, WindEvidence>();
  extractLevelEvidence(state.levels, evidence);
  extractPressureValueEvidence(state.pressureValues, evidence);
  extractFieldEvidence(state.fields, evidence);
  return evidence;
}

function extractLevelEvidence(
  levels: unknown,
  evidence: Map<string, WindEvidence>,
): void {
  if (!Array.isArray(levels)) return;
  for (const level of levels) {
    if (!isRecord(level)) continue;
    const pressureLevelHpa = finiteNumber(level.pressureHpa);
    if (pressureLevelHpa === undefined) continue;
    const sample = windSampleFromRecord(level);
    if (sample === undefined) continue;
    const descriptor: PressureWindDescriptor = { kind: "pressure_level", pressureLevelHpa };
    evidence.set(pressureKey(pressureLevelHpa), { descriptor, sample });
  }
}

function extractPressureValueEvidence(
  pressureValues: unknown,
  evidence: Map<string, WindEvidence>,
): void {
  if (!Array.isArray(pressureValues)) return;
  const components = new Map<number, { uWindMs?: number; vWindMs?: number }>();

  for (const entry of pressureValues) {
    if (!isRecord(entry)) continue;
    const pressureLevelHpa = finiteNumber(entry.pressureLevelHpa);
    if (pressureLevelHpa === undefined) continue;
    const descriptor: PressureWindDescriptor = { kind: "pressure_level", pressureLevelHpa };

    if (isRecord(entry.values)) {
      const sample = windSampleFromRecord(entry.values);
      if (sample !== undefined) {
        evidence.set(pressureKey(pressureLevelHpa), { descriptor, sample });
      }
      const uWindMs = finiteNumber(entry.values.uWindMs);
      const vWindMs = finiteNumber(entry.values.vWindMs);
      if (uWindMs !== undefined || vWindMs !== undefined) {
        const current = components.get(pressureLevelHpa) ?? {};
        components.set(pressureLevelHpa, {
          ...current,
          ...(uWindMs === undefined ? {} : { uWindMs }),
          ...(vWindMs === undefined ? {} : { vWindMs }),
        });
      }
    }

    const variable = typeof entry.variable === "string" ? entry.variable : undefined;
    const scalarValue = finiteNumber(entry.value);
    if (scalarValue !== undefined && (variable === "u_wind" || variable === "v_wind")) {
      const current = components.get(pressureLevelHpa) ?? {};
      components.set(pressureLevelHpa, {
        ...current,
        ...(variable === "u_wind" ? { uWindMs: scalarValue } : { vWindMs: scalarValue }),
      });
    }
  }

  for (const [pressureLevelHpa, component] of components) {
    if (component.uWindMs === undefined || component.vWindMs === undefined) continue;
    const descriptor: PressureWindDescriptor = { kind: "pressure_level", pressureLevelHpa };
    evidence.set(pressureKey(pressureLevelHpa), {
      descriptor,
      sample: windVectorSampleFromComponents(component.uWindMs, component.vWindMs),
    });
  }
}

function extractFieldEvidence(
  fields: unknown,
  evidence: Map<string, WindEvidence>,
): void {
  if (!Array.isArray(fields)) return;
  const components = new Map<string, { uWindMs?: number; vWindMs?: number }>();

  for (const entry of fields) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string"
      ? entry.id
      : typeof entry.field === "string"
        ? entry.field
        : undefined;
    if (id === undefined || !isRecord(entry.values)) continue;

    const directSample = windSampleFromRecord(entry.values);
    if (directSample !== undefined) {
      const field = canonicalWindField(id) ?? id;
      if (/^wind_\d+m$/.test(field)) {
        const descriptor: FieldWindDescriptor = { kind: "field", field };
        evidence.set(fieldKey(field), { descriptor, sample: directSample });
      }
    }

    const component = windComponentField(id);
    if (component === undefined) continue;
    const value = finiteNumber(entry.values[component.component === "u" ? "uWindMs" : "vWindMs"]);
    if (value === undefined) continue;
    const current = components.get(component.field) ?? {};
    components.set(component.field, {
      ...current,
      ...(component.component === "u" ? { uWindMs: value } : { vWindMs: value }),
    });
  }

  for (const [field, component] of components) {
    if (component.uWindMs === undefined || component.vWindMs === undefined) continue;
    const descriptor: FieldWindDescriptor = { kind: "field", field };
    evidence.set(fieldKey(field), {
      descriptor,
      sample: windVectorSampleFromComponents(component.uWindMs, component.vWindMs),
    });
  }
}

function windSampleFromRecord(record: Record<string, unknown>): WindVectorSample | undefined {
  const uWindMs = finiteNumber(record.uWindMs);
  const vWindMs = finiteNumber(record.vWindMs);
  if (uWindMs !== undefined && vWindMs !== undefined) {
    return windVectorSampleFromComponents(uWindMs, vWindMs);
  }

  const speedMs = finiteNumber(record.windSpeedMs);
  const directionDeg = finiteNumber(record.windDirectionDeg);
  if (speedMs !== undefined && directionDeg !== undefined) {
    return windVectorSampleFromSpeedDirection(speedMs, directionDeg);
  }
  return undefined;
}

function canonicalWindField(field: string): string | undefined {
  if (/^wind_\d+m$/.test(field)) return field;
  const component = windComponentField(field);
  return component?.field;
}

function windComponentField(
  field: string,
): { field: string; component: "u" | "v" } | undefined {
  const match = field.match(/^(u|v)_wind_(\d+)m$/);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return {
    field: `wind_${match[2]}m`,
    component: match[1] as "u" | "v",
  };
}

function pressureKey(pressureLevelHpa: number): string {
  return `pressure:${pressureLevelHpa}`;
}

function fieldKey(field: string): string {
  return `field:${field}`;
}

function stripMemberPayloads(node: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === "members" && isMemberPayloadArray(value)) {
      delete node[key];
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) stripMemberPayloads(item);
      }
    } else if (isRecord(value)) {
      stripMemberPayloads(value);
    }
  }
}

function isMemberPayloadArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((item) => isRecord(item) && typeof item.member === "string");
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
