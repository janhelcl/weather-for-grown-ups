import { homedir } from "node:os";
import { join } from "node:path";
import {
  type GefsMember,
  sortGefsMembers,
} from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  GefsS3SubsetCache,
  type GefsMemberSource,
} from "../cache/gefs-s3-subset-cache.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsEnsembleQuerySchema,
  gefsEnsembleResultSchema,
  type GefsEnsembleQueryInput,
  type GefsEnsembleResult,
} from "../schema/gefs-ensemble.js";
import type { DecodedValue } from "./types.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

export const DEFAULT_GEFS_MEMBER_CONCURRENCY = 6;

export interface GefsPointDecoder {
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface GefsEnsembleServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

export class GefsEnsembleService {
  private readonly source: GefsMemberSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsEnsembleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getEnsemble(input: GefsEnsembleQueryInput): Promise<GefsEnsembleResult> {
    const query = gefsEnsembleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const variable = VARIABLE_CATALOG[query.variable] as RawVariableDefinition;

    const samples = await mapConcurrent(members, this.concurrency, async (member) =>
      this.sampleMember(member, run, forecastHour, query.latitude, query.longitude, variable, query.pressureLevelHpa),
    );
    const first = samples[0];
    if (!first) throw new Error("GEFS ensemble produced no member samples");
    for (const sample of samples) {
      if (
        sample.gridPoint.latitude !== first.gridPoint.latitude ||
        sample.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS members resolved to inconsistent grid points for one ensemble query");
      }
    }

    const values = samples.map((sample) => sample.value);
    const output = variable.outputs[0];
    const threshold = query.thresholdGte === undefined
      ? undefined
      : thresholdSummary(values, query.thresholdGte);

    return gefsEnsembleResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        variable: query.variable,
        gfsCode: variable.gfsCode,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
      },
      members: samples.map(({ member, value, cacheHit }) => ({ member, value, cacheHit })),
      summary: {
        memberCount: values.length,
        mean: mean(values),
        populationStdDev: populationStdDev(values),
        min: Math.min(...values),
        max: Math.max(...values),
        quantiles: [...query.quantiles].sort((a, b) => a - b).map((quantileValue) => ({
          quantile: quantileValue,
          value: quantile(values, quantileValue),
        })),
        ...(threshold === undefined ? {} : { threshold }),
      },
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
    variable: RawVariableDefinition,
    pressureLevelHpa: number,
  ) {
    const file = await this.source.fetch({
      run,
      forecastHour,
      member,
      variableCode: variable.gfsCode,
      pressureLevelHpa,
    });
    const decoded = await this.decoder.extractPoint(file.path, longitude, latitude);
    const value = decoded.find((candidate) =>
      candidate.code === variable.gfsCode && candidate.pressureHpa === pressureLevelHpa,
    );
    if (!value) {
      throw new Error(`Decoded GEFS ${member} subset is missing ${variable.gfsCode}@${pressureLevelHpa}mb`);
    }
    return {
      member,
      value: normalizeValue(variable, value.value),
      gridPoint: value.gridPoint,
      cacheHit: file.cacheHit,
    };
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
  if (lower === undefined || upper === undefined) throw new Error("Cannot compute GEFS quantile from an empty ensemble");
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function thresholdSummary(values: readonly number[], threshold: number) {
  const count = values.filter((value) => value >= threshold).length;
  return {
    operator: "gte" as const,
    value: threshold,
    count,
    fraction: count / values.length,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}
