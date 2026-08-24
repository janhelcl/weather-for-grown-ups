import {
  GEFS_PGRB2A_FIELD_CATALOG,
  rawGefsFieldDefinitions,
  type GefsFieldDefinition,
  type GefsPgrb2aFieldId,
  type RawGefsFieldDefinition,
} from "../catalog/gefs-fields.js";
import {
  gefsProfileRawDependencies,
  type GefsMember,
  type GefsPressureVariableId,
  type GefsProfileVariableId,
} from "../catalog/gefs.js";
import {
  VARIABLE_CATALOG,
  type RawVariableDefinition,
  type VariableDefinition,
} from "../catalog/variables.js";
import { deriveWind } from "../derived/wind.js";
import type {
  GefsBundleSelection,
  GefsFieldTemporalResult,
} from "../schema/gefs-member-bundle.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import { deriveGefsProfileValue, gefsRawPressureKey } from "./gefs-profile-derivation.js";
import type { DecodedValue } from "./types.js";

export interface PreparedGefsBundleSelection {
  variables: GefsProfileVariableId[];
  pressureLevelsHpa: number[];
  fields: GefsPgrb2aFieldId[];
  requestedPressureVariables: RequestedPressureVariable[];
  rawPressureVariables: RawPressureVariable[];
  rawFields: RawGefsFieldDefinition[];
}

interface RequestedPressureVariable {
  id: GefsProfileVariableId;
  definition: VariableDefinition;
}

interface RawPressureVariable {
  id: GefsPressureVariableId;
  definition: RawVariableDefinition;
}

export interface GefsMemberPressureValue {
  variable: GefsProfileVariableId;
  pressureLevelHpa: number;
  value: number;
}

export interface GefsMemberFieldValue {
  field: GefsPgrb2aFieldId;
  temporal: GefsFieldTemporalResult;
  values: Record<string, number>;
}

export interface DecodedGefsMemberBundle {
  member: GefsMember;
  cacheHit: boolean;
  gridPoint: { latitude: number; longitude: number };
  pressureValues: GefsMemberPressureValue[];
  fields: GefsMemberFieldValue[];
}

export function prepareGefsBundleSelection(selection: GefsBundleSelection): PreparedGefsBundleSelection {
  const variables = [...selection.variables];
  const pressureLevelsHpa = [...selection.pressureLevelsHpa].sort((a, b) => b - a);
  const fields = [...selection.fields];
  return {
    variables,
    pressureLevelsHpa,
    fields,
    requestedPressureVariables: variables.map((id) => ({ id, definition: VARIABLE_CATALOG[id] })),
    rawPressureVariables: expandRawPressureDependencies(variables),
    rawFields: rawGefsFieldDefinitions(fields),
  };
}

export function decodeGefsMemberBundle(input: {
  member: GefsMember;
  cacheHit: boolean;
  decoded: readonly DecodedValue[];
  run: Date;
  selection: PreparedGefsBundleSelection;
}): DecodedGefsMemberBundle {
  const gridPoint = assertConsistentGridPoint(input.decoded, input.member);
  const rawPressureValues = readRawPressureValues(
    input.decoded,
    input.member,
    input.selection.rawPressureVariables,
    input.selection.pressureLevelsHpa,
  );
  const pressureValues = input.selection.pressureLevelsHpa.flatMap((pressureLevelHpa) =>
    input.selection.requestedPressureVariables.map(({ id }) => ({
      variable: id,
      pressureLevelHpa,
      value: deriveGefsProfileValue(id, pressureLevelHpa, rawPressureValues),
    })),
  );
  const fields = input.selection.fields.map((id) =>
    readFieldValue(GEFS_PGRB2A_FIELD_CATALOG[id], input.decoded, input.run),
  );
  return {
    member: input.member,
    cacheHit: input.cacheHit,
    gridPoint,
    pressureValues,
    fields,
  };
}

export function assertMemberBundlesShareGrid(
  samples: readonly DecodedGefsMemberBundle[],
  context = "GEFS member bundle",
): { latitude: number; longitude: number } {
  const first = samples[0];
  if (!first) throw new Error(`${context} produced no member samples`);
  for (const sample of samples) {
    if (
      sample.gridPoint.latitude !== first.gridPoint.latitude
      || sample.gridPoint.longitude !== first.gridPoint.longitude
    ) {
      throw new Error(`${context} resolved members to inconsistent grid points`);
    }
  }
  return first.gridPoint;
}

export function summarizeGefsMemberBundles(
  samples: readonly DecodedGefsMemberBundle[],
  selection: PreparedGefsBundleSelection,
  quantiles: readonly number[],
) {
  if (samples.length === 0) throw new Error("Cannot summarize an empty GEFS member bundle");

  const pressureSummaries = selection.pressureLevelsHpa.flatMap((pressureLevelHpa) =>
    selection.requestedPressureVariables.map(({ id, definition }) => {
      const output = definition.outputs[0];
      if (!output) throw new Error(`GEFS bundle variable ${id} has no output definition`);
      const values = samples.map((sample) => requiredMemberPressureValue(sample, id, pressureLevelHpa));
      return {
        variable: id,
        pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
        distribution: summarizeNumericDistribution(values, quantiles),
      };
    }),
  );

  const fieldSummaries = selection.fields.map((id) => {
    const definition = GEFS_PGRB2A_FIELD_CATALOG[id];
    const memberFields = samples.map((sample) => requiredMemberField(sample, id));
    const temporal = memberFields[0]?.temporal;
    if (!temporal) throw new Error(`GEFS bundle field ${id} produced no member values`);
    for (const field of memberFields) {
      if (!sameTemporal(field.temporal, temporal)) {
        throw new Error(`GEFS bundle field ${id} has inconsistent temporal intervals across members`);
      }
    }
    return {
      field: id,
      level: { ...definition.level },
      temporal,
      outputs: definition.outputs.map((output) => {
        const values = memberFields.map((field) => requiredOutput(field.values, output.field, id));
        if (id === "wind_10m" && output.field === "windDirectionDeg") {
          return {
            aggregation: "circular_direction" as const,
            field: "windDirectionDeg" as const,
            unit: "degree" as const,
            ...summarizeCircularDegrees(values),
          };
        }
        return {
          aggregation: "numeric_distribution" as const,
          field: output.field,
          unit: output.unit,
          distribution: summarizeNumericDistribution(values, quantiles),
        };
      }),
    };
  });

  return { pressureSummaries, fieldSummaries };
}

export function bundleScalarOutputCount(selection: PreparedGefsBundleSelection): number {
  return selection.variables.length * selection.pressureLevelsHpa.length
    + selection.fields.reduce((sum, id) => sum + GEFS_PGRB2A_FIELD_CATALOG[id].outputs.length, 0);
}

function expandRawPressureDependencies(variables: readonly GefsProfileVariableId[]): RawPressureVariable[] {
  const ids = new Set<GefsPressureVariableId>();
  for (const variable of variables) {
    for (const dependency of gefsProfileRawDependencies(variable)) ids.add(dependency);
  }
  return [...ids].map((id) => ({ id, definition: VARIABLE_CATALOG[id] as RawVariableDefinition }));
}

function readRawPressureValues(
  decoded: readonly DecodedValue[],
  member: GefsMember,
  variables: readonly RawPressureVariable[],
  pressureLevelsHpa: readonly number[],
): Map<string, number> {
  const values = new Map<string, number>();
  for (const pressureLevelHpa of pressureLevelsHpa) {
    for (const { id, definition } of variables) {
      const candidate = decoded.find((value) =>
        value.code === definition.gfsCode && value.pressureHpa === pressureLevelHpa,
      );
      if (!candidate) {
        throw new Error(`Decoded GEFS ${member} bundle is missing ${definition.gfsCode}@${pressureLevelHpa}mb`);
      }
      values.set(gefsRawPressureKey(id, pressureLevelHpa), normalizePressureValue(definition, candidate.value));
    }
  }
  return values;
}

function readFieldValue(
  definition: GefsFieldDefinition,
  decoded: readonly DecodedValue[],
  run: Date,
): GefsMemberFieldValue {
  if (definition.kind === "raw") {
    const candidate = decoded.find((value) => matchesRawField(definition, value));
    if (!candidate) {
      throw new Error(`Decoded GEFS bundle is missing ${definition.id} (${definition.gfsCode}@${definition.level.gribLevel})`);
    }
    const output = definition.outputs[0];
    return {
      field: definition.id,
      temporal: temporalResult(definition, candidate, run),
      values: { [output.field]: normalizeFieldValue(definition, candidate.value) },
    };
  }

  const uDefinition = GEFS_PGRB2A_FIELD_CATALOG[definition.dependencies[0]] as RawGefsFieldDefinition;
  const vDefinition = GEFS_PGRB2A_FIELD_CATALOG[definition.dependencies[1]] as RawGefsFieldDefinition;
  const u = decoded.find((value) => matchesRawField(uDefinition, value));
  const v = decoded.find((value) => matchesRawField(vDefinition, value));
  if (!u || !v) throw new Error(`Decoded GEFS bundle is missing dependencies for ${definition.id}`);
  const wind = deriveWind(u.value, v.value);
  return {
    field: definition.id,
    temporal: { type: "instantaneous" },
    values: { windSpeedMs: wind.speedMs, windDirectionDeg: wind.directionDeg },
  };
}

function matchesRawField(definition: RawGefsFieldDefinition, value: DecodedValue): boolean {
  if (value.code !== definition.gfsCode) return false;
  const gribLevel = definition.level.gribLevel;
  const heightMatch = gribLevel.match(/^(\d+(?:\.\d+)?) m above ground$/);
  const levelMatches = gribLevel === "surface"
    ? value.surface === true
    : heightMatch?.[1] !== undefined
      ? value.heightAboveGroundM === Number(heightMatch[1])
      : value.namedVertical === gribLevel;
  if (!levelMatches) return false;
  switch (definition.temporalSemantics) {
    case "instantaneous": return value.accumulation === undefined && value.average === undefined;
    case "accumulation": return value.accumulation !== undefined;
    case "average": return value.average !== undefined;
  }
}

function temporalResult(
  definition: RawGefsFieldDefinition,
  value: DecodedValue,
  run: Date,
): GefsFieldTemporalResult {
  if (definition.temporalSemantics === "instantaneous") return { type: "instantaneous" };
  const interval = definition.temporalSemantics === "accumulation" ? value.accumulation : value.average;
  if (!interval) throw new Error(`Decoded ${definition.id} is missing its ${definition.temporalSemantics} interval`);
  return {
    type: definition.temporalSemantics,
    ...interval,
    startTime: new Date(run.getTime() + interval.startForecastHour * 3_600_000).toISOString(),
    endTime: new Date(run.getTime() + interval.endForecastHour * 3_600_000).toISOString(),
  };
}

function assertConsistentGridPoint(
  decoded: readonly DecodedValue[],
  member: GefsMember,
): { latitude: number; longitude: number } {
  const first = decoded[0];
  if (!first) throw new Error(`Decoded GEFS ${member} bundle produced no values`);
  for (const value of decoded) {
    if (
      value.gridPoint.latitude !== first.gridPoint.latitude
      || value.gridPoint.longitude !== first.gridPoint.longitude
    ) {
      throw new Error(`Decoded GEFS ${member} bundle fields resolved to inconsistent grid points`);
    }
  }
  return first.gridPoint;
}

function normalizePressureValue(definition: RawVariableDefinition, value: number): number {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function normalizeFieldValue(definition: RawGefsFieldDefinition, value: number): number {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function requiredMemberPressureValue(
  sample: DecodedGefsMemberBundle,
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
): number {
  const match = sample.pressureValues.find((value) =>
    value.variable === variable && value.pressureLevelHpa === pressureLevelHpa,
  );
  if (!match) throw new Error(`GEFS bundle aggregation is missing ${variable}@${pressureLevelHpa}mb for ${sample.member}`);
  return match.value;
}

function requiredMemberField(sample: DecodedGefsMemberBundle, field: GefsPgrb2aFieldId): GefsMemberFieldValue {
  const match = sample.fields.find((value) => value.field === field);
  if (!match) throw new Error(`GEFS bundle aggregation is missing field ${field} for ${sample.member}`);
  return match;
}

function requiredOutput(values: Readonly<Record<string, number>>, output: string, field: string): number {
  const value = values[output];
  if (value === undefined) throw new Error(`GEFS bundle aggregation is missing ${field}.${output}`);
  return value;
}

function sameTemporal(left: GefsFieldTemporalResult, right: GefsFieldTemporalResult): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
