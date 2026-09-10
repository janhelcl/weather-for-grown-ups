import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import type { VariableId } from "../schema/query.js";
import type {
  AlignedCell,
  AlignedOutput,
  AlignedQuantitySelection,
} from "../schema/unified-alignment.js";
import type {
  QueryAtmosphereRequest,
  UnifiedAtmosphereResult,
} from "../schema/unified-api.js";

/**
 * Canonical reading of point evidence returned by `query_atmosphere`.
 *
 * Dataset-native point results differ in packaging (deterministic `levels` /
 * `fields`, ensemble `pressureSummaries` / `fieldSummaries` in several
 * historical shapes, instant payloads versus `series`). This module reads all
 * of them into one quantity-keyed representation so higher-level composition
 * never inspects provider-shaped payloads. It performs no retrieval and no
 * interpretation.
 */

export interface QuantityDescriptor {
  key: string;
  selection: AlignedQuantitySelection;
  output: AlignedOutput;
}

export interface GridPoint {
  latitude: number;
  longitude: number;
}

export interface EvidenceStep {
  validTime: string;
  forecastHour?: number;
  gridPoint?: GridPoint;
  cells: ReadonlyMap<string, AlignedCell>;
}

export interface PointEvidence {
  model?: string;
  run?: string;
  gridPoint?: GridPoint;
  memberCount?: number;
  source: unknown;
  steps: EvidenceStep[];
}

type ResultObject = Record<string, unknown>;

export function isCanonicalVariable(id: string): id is VariableId {
  return Object.hasOwn(VARIABLE_CATALOG, id);
}

export function isCanonicalField(id: string): id is NonIsobaricFieldId {
  return Object.hasOwn(NON_ISOBARIC_FIELD_CATALOG, id);
}

/**
 * Expand a public selection into the ordered list of canonical output
 * quantities it denotes: every pressure variable output at every requested
 * level, followed by every non-isobaric field output.
 */
export function expandSelectionQuantities(
  selection: QueryAtmosphereRequest["selection"],
): QuantityDescriptor[] {
  const quantities: QuantityDescriptor[] = [];
  for (const variable of selection.variables ?? []) {
    if (!isCanonicalVariable(variable)) continue;
    const definition = VARIABLE_CATALOG[variable];
    for (const pressureLevelHpa of selection.pressureLevelsHpa ?? []) {
      for (const output of definition.outputs) {
        quantities.push({
          key: pressureKey(variable, pressureLevelHpa, output.field),
          selection: { kind: "pressure", variable, pressureLevelHpa },
          output: canonicalOutput(output.field, output.unit),
        });
      }
    }
  }
  for (const field of selection.fields ?? []) {
    if (!isCanonicalField(field)) continue;
    const definition = NON_ISOBARIC_FIELD_CATALOG[field];
    for (const output of definition.outputs) {
      quantities.push({
        key: fieldKey(field, output.field),
        selection: {
          kind: "field",
          field,
          temporalSemantics: definition.temporalSemantics,
        },
        output: canonicalOutput(output.field, output.unit),
      });
    }
  }
  return quantities;
}

export function readPointEvidence(
  response: UnifiedAtmosphereResult,
  quantities: readonly QuantityDescriptor[],
): PointEvidence {
  const result = asObject(response.result, "point result");
  const rawSteps = Array.isArray(result.series) ? result.series : [result];
  const steps = rawSteps.map((rawStep) => readStep(asObject(rawStep, "time step"), quantities));
  const point = gridPoint(result.gridPoint);
  const members = memberCount(result);
  return {
    ...(typeof result.model === "string" ? { model: result.model } : {}),
    ...(typeof result.run === "string" ? { run: result.run } : {}),
    ...(point === undefined ? {} : { gridPoint: point }),
    ...(members === undefined ? {} : { memberCount: members }),
    source: result.source,
    steps,
  };
}

function readStep(step: ResultObject, quantities: readonly QuantityDescriptor[]): EvidenceStep {
  const validTime = step.validTime ?? step.analysisTime;
  if (typeof validTime !== "string") {
    throw new Error("Point evidence step is missing validTime");
  }
  const cells = new Map<string, AlignedCell>();
  for (const quantity of quantities) {
    cells.set(quantity.key, readCell(step, quantity));
  }
  const point = gridPoint(step.gridPoint);
  return {
    validTime,
    ...(typeof step.forecastHour === "number" ? { forecastHour: step.forecastHour } : {}),
    ...(point === undefined ? {} : { gridPoint: point }),
    cells,
  };
}

function readCell(step: ResultObject, quantity: QuantityDescriptor): AlignedCell {
  return quantity.selection.kind === "pressure"
    ? readPressureCell(step, quantity.selection.variable, quantity.selection.pressureLevelHpa, quantity.output.field)
    : readFieldCell(step, quantity.selection.field, quantity.output.field);
}

function readPressureCell(
  step: ResultObject,
  variable: string,
  pressureLevelHpa: number,
  outputField: string,
): AlignedCell {
  if (Array.isArray(step.levels)) {
    const level = step.levels
      .map((entry) => asObject(entry, "pressure level"))
      .find((entry) => entry.pressureHpa === pressureLevelHpa);
    const value = level?.[outputField];
    return typeof value === "number" && Number.isFinite(value)
      ? { kind: "value", value }
      : missing();
  }
  if (Array.isArray(step.pressureSummaries)) {
    for (const raw of step.pressureSummaries) {
      const summary = asObject(raw, "pressure summary");
      if (summary.pressureLevelHpa !== pressureLevelHpa) continue;
      const cell = summaryCell(summary, variable, outputField);
      if (cell !== undefined) return cell;
    }
    return missing();
  }
  return missing();
}

function readFieldCell(step: ResultObject, fieldId: string, outputField: string): AlignedCell {
  if (Array.isArray(step.fields)) {
    const field = step.fields
      .map((entry) => asObject(entry, "field"))
      .find((entry) => entry.id === fieldId || entry.field === fieldId);
    if (field === undefined) return missing();
    const value = asObject(field.values ?? {}, "field values")[outputField];
    return typeof value === "number" && Number.isFinite(value)
      ? { kind: "value", value, ...windowOf(field.temporal) }
      : missing();
  }
  if (Array.isArray(step.fieldSummaries)) {
    for (const raw of step.fieldSummaries) {
      const summary = asObject(raw, "field summary");
      if (summary.field !== fieldId && summary.id !== fieldId) continue;
      const cell = summaryCell(summary, fieldId, outputField);
      if (cell !== undefined) return { ...cell, ...windowOf(summary.temporal) } as AlignedCell;
    }
    return missing();
  }
  return missing();
}

/**
 * Ensemble summaries come in three native packagings:
 *  - `{ variable, pressureLevelHpa, outputs: [{ aggregation, field, distribution | circular }] }`
 *  - `{ variable, pressureLevelHpa, outputField, distribution }`
 *  - `{ pressureLevelHpa, field: outputField, aggregation, distribution }`
 * Field summaries use the first form keyed by `field: fieldId`.
 */
function summaryCell(
  summary: ResultObject,
  selectionId: string,
  outputField: string,
): AlignedCell | undefined {
  const matchesSelection = summary.variable === selectionId
    || summary.field === selectionId
    || summary.id === selectionId
    || (summary.variable === undefined && summary.field === outputField);
  if (!matchesSelection) return undefined;

  if (Array.isArray(summary.outputs)) {
    const output = summary.outputs
      .map((entry) => asObject(entry, "summary output"))
      .find((entry) => entry.field === outputField);
    return output === undefined ? undefined : aggregationCell(output);
  }
  if (summary.outputField === outputField || summary.field === outputField) {
    return aggregationCell(summary);
  }
  return undefined;
}

function aggregationCell(output: ResultObject): AlignedCell | undefined {
  if (output.aggregation === "circular_direction") {
    const memberCountValue = output.memberCount;
    const meanDirectionDeg = output.meanDirectionDeg;
    const resultantLength = output.resultantLength;
    if (
      typeof memberCountValue === "number"
      && typeof meanDirectionDeg === "number"
      && typeof resultantLength === "number"
    ) {
      return { kind: "circular_direction", memberCount: memberCountValue, meanDirectionDeg, resultantLength };
    }
    return undefined;
  }
  if (output.distribution === undefined) return undefined;
  const distribution = asObject(output.distribution, "distribution");
  const numbers = ["memberCount", "mean", "populationStdDev", "min", "max"] as const;
  const values: Partial<Record<(typeof numbers)[number], number>> = {};
  for (const key of numbers) {
    const value = distribution[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    values[key] = value;
  }
  const quantiles = Array.isArray(distribution.quantiles)
    ? distribution.quantiles
        .map((entry) => asObject(entry, "quantile"))
        .filter((entry) => typeof entry.quantile === "number" && typeof entry.value === "number")
        .map((entry) => ({ quantile: entry.quantile as number, value: entry.value as number }))
    : [];
  return {
    kind: "distribution",
    memberCount: values.memberCount!,
    mean: values.mean!,
    populationStdDev: values.populationStdDev!,
    min: values.min!,
    max: values.max!,
    quantiles,
  };
}

function windowOf(temporal: unknown): { window?: { type: "accumulation" | "average" | "maximum"; startTime: string; endTime: string } } {
  if (typeof temporal !== "object" || temporal === null) return {};
  const record = temporal as ResultObject;
  if (
    (record.type === "accumulation" || record.type === "average" || record.type === "maximum")
    && typeof record.startTime === "string"
    && typeof record.endTime === "string"
  ) {
    return { window: { type: record.type, startTime: record.startTime, endTime: record.endTime } };
  }
  return {};
}

function memberCount(result: ResultObject): number | undefined {
  if (Array.isArray(result.members) && result.members.length > 0) return result.members.length;
  const selection = typeof result.selection === "object" && result.selection !== null
    ? (result.selection as ResultObject)
    : undefined;
  if (selection !== undefined && Array.isArray(selection.members)) return selection.members.length;
  const source = typeof result.source === "object" && result.source !== null
    ? (result.source as ResultObject)
    : undefined;
  if (source !== undefined && typeof source.memberCount === "number") return source.memberCount;
  return undefined;
}

function gridPoint(value: unknown): GridPoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as ResultObject;
  return typeof record.latitude === "number" && typeof record.longitude === "number"
    ? { latitude: record.latitude, longitude: record.longitude }
    : undefined;
}

function canonicalOutput(field: string, unit: string): AlignedOutput {
  return {
    field,
    unit,
    deltaKind: field === "windDirectionDeg" ? "circular_degrees" : "linear",
  };
}

function pressureKey(variable: string, pressureLevelHpa: number, outputField: string): string {
  return `pressure:${variable}@${pressureLevelHpa}:${outputField}`;
}

function fieldKey(field: string, outputField: string): string {
  return `field:${field}:${outputField}`;
}

function missing(): AlignedCell {
  return { kind: "unavailable", reason: "output_missing" };
}

function asObject(value: unknown, context: string): ResultObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Point evidence ${context} is not an object`);
  }
  return value as ResultObject;
}
