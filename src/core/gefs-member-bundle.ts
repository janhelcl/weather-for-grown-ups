import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import {
  GEFS_PGRB2A_FIELD_CATALOG,
  rawGefsFieldDefinitions,
  type GefsFieldDefinition,
  type GefsPgrb2aFieldId,
  type RawGefsFieldDefinition,
} from "../catalog/gefs-fields.js";
import {
  gefsProfileRawDependencies,
  sortGefsMembers,
  type GefsMember,
  type GefsPressureVariableId,
  type GefsProfileVariableId,
} from "../catalog/gefs.js";
import {
  VARIABLE_CATALOG,
  type RawVariableDefinition,
  type VariableDefinition,
} from "../catalog/variables.js";
import { deriveDewPointC, derivePotentialTemperatureK } from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsMemberBundleQuerySchema,
  gefsMemberBundleResultSchema,
  type GefsFieldTemporalResult,
  type GefsMemberBundleQueryInput,
  type GefsMemberBundleResult,
} from "../schema/gefs-member-bundle.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import type { DecodedValue } from "./types.js";

interface RequestedPressureVariable {
  id: GefsProfileVariableId;
  definition: VariableDefinition;
}

interface MemberPressureValue {
  variable: GefsProfileVariableId;
  pressureLevelHpa: number;
  value: number;
}

interface MemberFieldValue {
  field: GefsPgrb2aFieldId;
  temporal: GefsFieldTemporalResult;
  values: Record<string, number>;
}

interface MemberBundleSample {
  member: GefsMember;
  cacheHit: boolean;
  gridPoint: { latitude: number; longitude: number };
  pressureValues: MemberPressureValue[];
  fields: MemberFieldValue[];
}

export interface GefsMemberBundleServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

/**
 * Fetch and decode one mixed GEFS pgrb2a selection per member. Pressure-level
 * dependencies and non-isobaric field dependencies are merged into one local
 * GRIB slice before wgrib2 is invoked, so upstream work scales with members,
 * not with the number of requested fields.
 */
export class GefsMemberBundleService {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsMemberBundleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getBundle(input: GefsMemberBundleQueryInput): Promise<GefsMemberBundleResult> {
    const query = gefsMemberBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const variables = [...query.selection.variables];
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa].sort((a, b) => b - a);
    const fields = [...query.selection.fields];
    const requestedPressureVariables = variables.map((id): RequestedPressureVariable => ({
      id,
      definition: VARIABLE_CATALOG[id],
    }));
    const rawPressureVariables = expandRawPressureDependencies(variables);
    const rawFields = rawGefsFieldDefinitions(fields);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);

    const samples = await mapConcurrent(members, this.concurrency, async (member) =>
      this.sampleMember({
        member,
        run,
        forecastHour,
        latitude: query.latitude,
        longitude: query.longitude,
        requestedPressureVariables,
        rawPressureVariables,
        pressureLevelsHpa,
        requestedFields: fields,
        rawFields,
      }),
    );
    const first = samples[0];
    if (!first) throw new Error("GEFS member bundle produced no member samples");
    for (const sample of samples) {
      if (
        sample.gridPoint.latitude !== first.gridPoint.latitude
        || sample.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS member bundle resolved members to inconsistent grid points");
      }
    }

    const pressureSummaries = pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      requestedPressureVariables.map(({ id, definition }) => {
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

    const fieldSummaries = fields.map((id) => {
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

    return gefsMemberBundleResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: { variables, pressureLevelsHpa, fields, members, quantiles },
      pressureSummaries,
      fieldSummaries,
      ...(query.includeMembers
        ? {
            members: samples.map(({ member, cacheHit, pressureValues, fields: memberFields }) => ({
              member,
              cacheHit,
              pressureValues,
              fields: memberFields,
            })),
          }
        : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: samples.every((sample) => sample.cacheHit),
      },
    });
  }

  private async sampleMember(input: {
    member: GefsMember;
    run: Date;
    forecastHour: number;
    latitude: number;
    longitude: number;
    requestedPressureVariables: readonly RequestedPressureVariable[];
    rawPressureVariables: readonly { id: GefsPressureVariableId; definition: RawVariableDefinition }[];
    pressureLevelsHpa: readonly number[];
    requestedFields: readonly GefsPgrb2aFieldId[];
    rawFields: readonly RawGefsFieldDefinition[];
  }): Promise<MemberBundleSample> {
    const file = await this.source.fetchSelection({
      run: input.run,
      forecastHour: input.forecastHour,
      member: input.member,
      variableCodes: input.rawPressureVariables.map(({ definition }) => definition.gfsCode),
      pressureLevelsHpa: [...input.pressureLevelsHpa],
      fields: [...input.rawFields],
    });
    const decoded = await this.decoder.extractPoint(file.path, input.longitude, input.latitude);
    const gridPoint = assertConsistentGridPoint(decoded, input.member);
    const rawPressureValues = readRawPressureValues(
      decoded,
      input.member,
      input.rawPressureVariables,
      input.pressureLevelsHpa,
    );
    const pressureValues = input.pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      input.requestedPressureVariables.map(({ id }) => ({
        variable: id,
        pressureLevelHpa,
        value: derivedPressureValue(id, pressureLevelHpa, rawPressureValues),
      })),
    );
    const fields = input.requestedFields.map((id) =>
      readFieldValue(GEFS_PGRB2A_FIELD_CATALOG[id], decoded, input.run),
    );
    return { member: input.member, cacheHit: file.cacheHit, gridPoint, pressureValues, fields };
  }
}

function expandRawPressureDependencies(
  variables: readonly GefsProfileVariableId[],
): { id: GefsPressureVariableId; definition: RawVariableDefinition }[] {
  const ids = new Set<GefsPressureVariableId>();
  for (const variable of variables) {
    for (const dependency of gefsProfileRawDependencies(variable)) ids.add(dependency);
  }
  return [...ids].map((id) => ({ id, definition: VARIABLE_CATALOG[id] as RawVariableDefinition }));
}

function readRawPressureValues(
  decoded: readonly DecodedValue[],
  member: GefsMember,
  variables: readonly { id: GefsPressureVariableId; definition: RawVariableDefinition }[],
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
      values.set(pressureKey(id, pressureLevelHpa), normalizePressureValue(definition, candidate.value));
    }
  }
  return values;
}

function derivedPressureValue(
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
  rawValues: ReadonlyMap<string, number>,
): number {
  switch (variable) {
    case "dew_point":
      return deriveDewPointC(
        requireRawPressure(rawValues, "temperature", pressureLevelHpa),
        requireRawPressure(rawValues, "relative_humidity", pressureLevelHpa),
      );
    case "potential_temperature":
      return derivePotentialTemperatureK(
        requireRawPressure(rawValues, "temperature", pressureLevelHpa),
        pressureLevelHpa,
      );
    default:
      return requireRawPressure(rawValues, variable, pressureLevelHpa);
  }
}

function readFieldValue(
  definition: GefsFieldDefinition,
  decoded: readonly DecodedValue[],
  run: Date,
): MemberFieldValue {
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

function requireRawPressure(
  values: ReadonlyMap<string, number>,
  variable: GefsPressureVariableId,
  pressureLevelHpa: number,
): number {
  const value = values.get(pressureKey(variable, pressureLevelHpa));
  if (value === undefined) {
    throw new Error(`Internal GEFS bundle dependency missing: ${variable}@${pressureLevelHpa}mb`);
  }
  return value;
}

function requiredMemberPressureValue(
  sample: MemberBundleSample,
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
): number {
  const match = sample.pressureValues.find((value) =>
    value.variable === variable && value.pressureLevelHpa === pressureLevelHpa,
  );
  if (!match) throw new Error(`GEFS bundle aggregation is missing ${variable}@${pressureLevelHpa}mb for ${sample.member}`);
  return match.value;
}

function requiredMemberField(sample: MemberBundleSample, field: GefsPgrb2aFieldId): MemberFieldValue {
  const match = sample.fields.find((value) => value.field === field);
  if (!match) throw new Error(`GEFS bundle aggregation is missing field ${field} for ${sample.member}`);
  return match;
}

function requiredOutput(values: Readonly<Record<string, number>>, output: string, field: string): number {
  const value = values[output];
  if (value === undefined) throw new Error(`GEFS bundle aggregation is missing ${field}.${output}`);
  return value;
}

function pressureKey(variable: GefsPressureVariableId, pressureLevelHpa: number): string {
  return `${variable}@${pressureLevelHpa}`;
}

function sameTemporal(left: GefsFieldTemporalResult, right: GefsFieldTemporalResult): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
