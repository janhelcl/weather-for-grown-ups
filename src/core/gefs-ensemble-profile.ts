import { homedir } from "node:os";
import { join } from "node:path";
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
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import {
  deriveDewPointC,
  derivePotentialTemperatureK,
} from "../derived/thermodynamics.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsEnsembleProfileQuerySchema,
  gefsEnsembleProfileResultSchema,
  type GefsEnsembleProfileQueryInput,
  type GefsEnsembleProfileResult,
} from "../schema/gefs-ensemble-profile.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

export interface GefsEnsembleProfileServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

interface MemberProfileValue {
  variable: GefsProfileVariableId;
  pressureLevelHpa: number;
  value: number;
}

interface RequestedVariable {
  id: GefsProfileVariableId;
  definition: VariableDefinition;
}

export class GefsEnsembleProfileService {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsEnsembleProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getProfile(input: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult> {
    const query = gefsEnsembleProfileQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const requestedVariables: RequestedVariable[] = query.variables.map((id) => ({
      id,
      definition: VARIABLE_CATALOG[id],
    }));
    const rawVariables = expandRawDependencies(query.variables);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);

    const samples = await mapConcurrent(members, this.concurrency, async (member) =>
      this.sampleMember(
        member,
        run,
        forecastHour,
        query.latitude,
        query.longitude,
        requestedVariables,
        rawVariables,
        pressureLevelsHpa,
      ),
    );
    const first = samples[0];
    if (!first) throw new Error("GEFS ensemble profile produced no member samples");
    for (const sample of samples) {
      if (
        sample.gridPoint.latitude !== first.gridPoint.latitude ||
        sample.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS members resolved to inconsistent grid points for one ensemble profile query");
      }
    }

    const summaries = pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      requestedVariables.map(({ id, definition }) => {
        const values = samples.map((sample) => {
          const match = sample.values.find((candidate) =>
            candidate.variable === id && candidate.pressureLevelHpa === pressureLevelHpa,
          );
          if (!match) throw new Error(`Internal GEFS profile aggregation error for ${id}@${pressureLevelHpa}mb`);
          return match.value;
        });
        const output = definition.outputs[0];
        if (!output) throw new Error(`GEFS profile variable ${id} has no output definition`);
        return {
          variable: id,
          ...(definition.kind === "raw"
            ? { gfsCode: definition.gfsCode }
            : { dependencies: [...definition.dependencies] }),
          pressureLevelHpa,
          outputField: output.field,
          unit: output.unit,
          ...summarizeNumericDistribution(values, quantiles),
        };
      }),
    );

    return gefsEnsembleProfileResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa,
        members,
        quantiles,
      },
      summaries,
      ...(query.includeMembers
        ? {
            members: samples.map(({ member, cacheHit, values }) => ({ member, cacheHit, values })),
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

  private async sampleMember(
    member: GefsMember,
    run: Date,
    forecastHour: number,
    latitude: number,
    longitude: number,
    requestedVariables: readonly RequestedVariable[],
    rawVariables: readonly { id: GefsPressureVariableId; definition: RawVariableDefinition }[],
    pressureLevelsHpa: number[],
  ) {
    const file = await this.source.fetchSelection({
      run,
      forecastHour,
      member,
      variableCodes: rawVariables.map(({ definition }) => definition.gfsCode),
      pressureLevelsHpa,
    });
    const decoded = await this.decoder.extractPoint(file.path, longitude, latitude);
    const rawValues = new Map<string, number>();
    let gridPoint: { latitude: number; longitude: number } | undefined;

    for (const pressureLevelHpa of pressureLevelsHpa) {
      for (const { id, definition } of rawVariables) {
        const candidate = decoded.find((value) =>
          value.code === definition.gfsCode && value.pressureHpa === pressureLevelHpa,
        );
        if (!candidate) {
          throw new Error(`Decoded GEFS ${member} profile is missing ${definition.gfsCode}@${pressureLevelHpa}mb`);
        }
        if (
          gridPoint !== undefined &&
          (candidate.gridPoint.latitude !== gridPoint.latitude || candidate.gridPoint.longitude !== gridPoint.longitude)
        ) {
          throw new Error(`Decoded GEFS ${member} profile fields resolved to inconsistent grid points`);
        }
        gridPoint ??= candidate.gridPoint;
        rawValues.set(rawKey(id, pressureLevelHpa), normalizeValue(definition, candidate.value));
      }
    }

    if (!gridPoint) throw new Error(`Decoded GEFS ${member} profile produced no values`);
    const values = pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      requestedVariables.map(({ id }) => ({
        variable: id,
        pressureLevelHpa,
        value: memberVariableValue(id, pressureLevelHpa, rawValues),
      })),
    );
    return { member, cacheHit: file.cacheHit, gridPoint, values };
  }
}

function expandRawDependencies(
  variables: readonly GefsProfileVariableId[],
): { id: GefsPressureVariableId; definition: RawVariableDefinition }[] {
  const ids = new Set<GefsPressureVariableId>();
  for (const variable of variables) {
    for (const dependency of gefsProfileRawDependencies(variable)) ids.add(dependency);
  }
  return [...ids].map((id) => ({
    id,
    definition: VARIABLE_CATALOG[id] as RawVariableDefinition,
  }));
}

function memberVariableValue(
  variable: GefsProfileVariableId,
  pressureLevelHpa: number,
  rawValues: ReadonlyMap<string, number>,
): number {
  switch (variable) {
    case "dew_point":
      return deriveDewPointC(
        requireRaw(rawValues, "temperature", pressureLevelHpa),
        requireRaw(rawValues, "relative_humidity", pressureLevelHpa),
      );
    case "potential_temperature":
      return derivePotentialTemperatureK(
        requireRaw(rawValues, "temperature", pressureLevelHpa),
        pressureLevelHpa,
      );
    default:
      return requireRaw(rawValues, variable, pressureLevelHpa);
  }
}

function requireRaw(
  values: ReadonlyMap<string, number>,
  variable: GefsPressureVariableId,
  pressureLevelHpa: number,
): number {
  const value = values.get(rawKey(variable, pressureLevelHpa));
  if (value === undefined) {
    throw new Error(`Internal GEFS derived-variable dependency missing: ${variable}@${pressureLevelHpa}mb`);
  }
  return value;
}

function rawKey(variable: GefsPressureVariableId, pressureLevelHpa: number): string {
  return `${variable}@${pressureLevelHpa}`;
}

function normalizeValue(variable: RawVariableDefinition, value: number): number {
  const output = variable.outputs[0];
  if (variable.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}
