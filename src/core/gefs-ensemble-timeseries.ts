import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsEnsembleTimeSeriesQuerySchema,
  gefsEnsembleTimeSeriesResultSchema,
  type GefsEnsembleTimeSeriesQueryInput,
  type GefsEnsembleTimeSeriesResult,
} from "../schema/gefs-ensemble-timeseries.js";
import type { GefsEnsembleQueryInput, GefsEnsembleResult } from "../schema/gefs-ensemble.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsEnsembleService } from "./gefs-ensemble.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunRangeProvider,
} from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

const THREE_HOURS_MS = 3 * 3_600_000;
export const DEFAULT_GEFS_TIME_STEP_CONCURRENCY = 2;

export interface GefsEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export interface GefsEnsembleTimeSeriesServiceOptions {
  ensembleGetter?: GefsEnsembleGetter;
  latestRunRangeProvider?: GefsLatestRunRangeProvider;
  stepConcurrency?: number;
}

export class GefsEnsembleTimeSeriesService {
  private readonly ensembleGetter: GefsEnsembleGetter;
  private readonly latestRunRangeProvider: GefsLatestRunRangeProvider;
  private readonly stepConcurrency: number;

  constructor(options: GefsEnsembleTimeSeriesServiceOptions = {}) {
    this.ensembleGetter = options.ensembleGetter ?? new GefsEnsembleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_TIME_STEP_CONCURRENCY;
  }

  async getTimeSeries(input: GefsEnsembleTimeSeriesQueryInput): Promise<GefsEnsembleTimeSeriesResult> {
    const query = gefsEnsembleTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortGefsMembers(query.members);
    const times = buildNativeTimes(startTime, endTime, query.maxSteps);

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunRange(startTime, endTime, members)
      : parseGefsRun(query.run);

    // Validate both ends against one explicit run before any member downloads. This catches
    // negative forecast hours, non-native cadence, and the f384 contract early.
    gefsForecastHour(run, startTime);
    gefsForecastHour(run, endTime);

    const results = await mapConcurrent(times, this.stepConcurrency, async (validTime) =>
      this.ensembleGetter.getEnsemble({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        members,
        quantiles: query.quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      }),
    );

    const first = results[0];
    if (!first) throw new Error("GEFS ensemble time series produced no forecast steps");
    for (const result of results) {
      if (result.run !== first.run) throw new Error("GEFS ensemble time series drifted between model runs");
      if (
        result.gridPoint.latitude !== first.gridPoint.latitude ||
        result.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS ensemble time-series steps resolved to inconsistent grid points");
      }
    }

    return gefsEnsembleTimeSeriesResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stepHours: 3,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        ...first.selection,
        members,
        quantiles: [...query.quantiles].sort((a, b) => a - b),
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      },
      includeMembers: query.includeMembers,
      series: results.map((result) => ({
        validTime: result.validTime,
        forecastHour: result.forecastHour,
        summary: result.summary,
        ...(query.includeMembers ? { members: result.members } : {}),
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: results.every((result) => result.source.allCacheHit),
      },
    });
  }
}

function buildNativeTimes(startTime: Date, endTime: Date, maxSteps: number): Date[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("GEFS ensemble time-series endTime must be at or after startTime");
  }
  if (!isNativeValidTime(startTime) || !isNativeValidTime(endTime)) {
    throw new Error("GEFS ensemble time-series bounds must be exact native three-hour valid times");
  }
  const span = endTime.getTime() - startTime.getTime();
  if (span % THREE_HOURS_MS !== 0) {
    throw new Error("GEFS ensemble time-series range must align to the native three-hour cadence");
  }
  const count = span / THREE_HOURS_MS + 1;
  if (count > maxSteps) {
    throw new Error(`GEFS ensemble time series would contain ${count} steps, exceeding maxSteps=${maxSteps}`);
  }
  return Array.from({ length: count }, (_, index) => new Date(startTime.getTime() + index * THREE_HOURS_MS));
}

function isNativeValidTime(value: Date): boolean {
  return value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0
    && value.getUTCMilliseconds() === 0
    && value.getUTCHours() % 3 === 0;
}
