import { homedir } from "node:os";
import { join } from "node:path";
import { sortGefsMembers, type GefsMember, type GefsPressureVariableId } from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsEnsembleProfileQuerySchema,
  gefsEnsembleProfileResultSchema,
  type GefsEnsembleProfileQueryInput,
  type GefsEnsembleProfileResult,
} from "../schema/gefs-ensemble-profile.js";
import { mapConcurrent } from "./concurrency.js";
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
  variable: GefsPressureVariableId;
  pressureLevelHpa: number;
  value: number;
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
    const variables = query.variables.map((variable) => ({
      id: variable,
      definition: VARIABLE_CATALOG[variable] as RawVariableDefinition,
    }));
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
        variables,
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
      variables.map(({ id, definition }) => {
        const values = samples.map((sample) => {
          const match = sample.values.find((candidate) =>
            candidate.variable === id && candidate.pressureLevelHpa === pressureLevelHpa,
          );
          if (!match) throw new Error(`Internal GEFS profile aggregation error for ${id}@${pressureLevelHpa}mb`);
          return match.value;
        });
        const output = definition.outputs[0];
        return {
          variable: id,
          gfsCode: definition.gfsCode,
          pressureLevelHpa,
          outputField: output.field,
          unit: output.unit,
          memberCount: values.length,
          mean: mean(values),
          populationStdDev: populationStdDev(values),
          min: Math.min(...values),
          max: Math.max(...values),
          quantiles: quantiles.map((quantileValue) => ({
            quantile: quantileValue,
            value: quantile(values, quantileValue),
          })),
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
    variables: readonly { id: GefsPressureVariableId; definition: RawVariableDefinition }[],
    pressureLevelsHpa: number[],
  ) {
    const file = await this.source.fetchSelection({
      run,
      forecastHour,
      member,
      variableCodes: variables.map(({ definition }) => definition.gfsCode),
      pressureLevelsHpa,
    });
    const decoded = await this.decoder.extractPoint(file.path, longitude, latitude);
    const values: MemberProfileValue[] = [];
    let gridPoint: { latitude: number; longitude: number } | undefined;

    for (const pressureLevelHpa of pressureLevelsHpa) {
      for (const { id, definition } of variables) {
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
        values.push({
          variable: id,
          pressureLevelHpa,
          value: normalizeValue(definition, candidate.value),
        });
      }
    }

    if (!gridPoint) throw new Error(`Decoded GEFS ${member} profile produced no values`);
    return { member, cacheHit: file.cacheHit, gridPoint, values };
  }
}

function normalizeValue(variable: RawVariableDefinition, value: number): number {
  const output = variable.outputs[0];
  if (variable.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationStdDev(values: readonly number[]): number {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = q * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("Cannot compute GEFS profile quantile from an empty ensemble");
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
