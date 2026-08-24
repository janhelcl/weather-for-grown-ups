import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsBatchPointsResultSchema,
  type GefsBatchPointsQueryInput,
  type GefsBatchPointsResult,
} from "../schema/gefs-batch-points.js";
import {
  gefsPointsTimeSeriesQuerySchema,
  gefsPointsTimeSeriesResultSchema,
  type GefsPointsTimeSeriesQueryInput,
  type GefsPointsTimeSeriesResult,
} from "../schema/gefs-points-timeseries.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsBatchPointsService } from "./gefs-batch-points.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunRangeProvider,
} from "./gefs-latest-run.js";
import { gefsForecastHour, nativeGefsValidTimesInRange, parseGefsRun } from "./gefs-time.js";

export const DEFAULT_GEFS_POINTS_TIME_SERIES_CONCURRENCY = 2;

export interface GefsBatchPointsGetter {
  getPoints(query: GefsBatchPointsQueryInput): Promise<GefsBatchPointsResult>;
}

export interface GefsPointsTimeSeriesServiceOptions {
  batchPointsGetter?: GefsBatchPointsGetter;
  latestRunRangeProvider?: GefsLatestRunRangeProvider;
  stepConcurrency?: number;
}

/**
 * Multi-point × multi-time GEFS access.
 *
 * One run is fixed for the complete range. For every native three-hour step,
 * GefsBatchPointsService fetches one selected field slice per member and samples
 * all requested coordinates locally. Upstream selected-field work therefore
 * scales with forecast steps × members, not forecast steps × members × points.
 */
export class GefsPointsTimeSeriesService {
  private readonly batchPointsGetter: GefsBatchPointsGetter;
  private readonly latestRunRangeProvider: GefsLatestRunRangeProvider;
  private readonly stepConcurrency: number;

  constructor(options: GefsPointsTimeSeriesServiceOptions = {}) {
    this.batchPointsGetter = options.batchPointsGetter ?? new GefsBatchPointsService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_POINTS_TIME_SERIES_CONCURRENCY;
  }

  async getPointsTimeSeries(input: GefsPointsTimeSeriesQueryInput): Promise<GefsPointsTimeSeriesResult> {
    const query = gefsPointsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const times = nativeGefsValidTimesInRange(startTime, endTime, query.maxSteps);

    const samples = query.points.length * times.length;
    if (samples > query.maxSamples) {
      throw new Error(
        `Requested GEFS matrix contains ${query.points.length} points × ${times.length} steps = ${samples} point-steps, exceeding maxSamples=${query.maxSamples}. Narrow the points/range or raise maxSamples.`,
      );
    }

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunRange(startTime, endTime, members)
      : parseGefsRun(query.run);

    // Validate the complete requested range against one cycle before any member
    // field downloads. This catches negative/out-of-range forecast hours early.
    gefsForecastHour(run, startTime);
    gefsForecastHour(run, endTime);

    const batches = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime) => this.batchPointsGetter.getPoints({
        points: query.points,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        members,
        quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
        includeMembers: query.includeMembers,
      }),
    );

    const first = batches[0];
    if (!first) throw new Error("GEFS multi-point time series produced no forecast steps");
    const runIso = run.toISOString();

    for (const [batchIndex, rawBatch] of batches.entries()) {
      const batch = gefsBatchPointsResultSchema.parse(rawBatch);
      const expectedValidTime = times[batchIndex]!;
      const expectedForecastHour = gefsForecastHour(run, expectedValidTime);
      if (
        batch.run !== runIso
        || batch.validTime !== expectedValidTime.toISOString()
        || batch.forecastHour !== expectedForecastHour
      ) {
        throw new Error("GEFS batched point result changed run or valid time within one multi-point time-series query");
      }
      if (
        batch.source.provider !== "NOAA AWS Open Data"
        || batch.source.access !== "s3_range"
        || batch.source.decoder !== "wgrib2"
        || batch.source.product !== "pgrb2a_0p50"
      ) {
        throw new Error("GEFS multi-point time series require the NOAA AWS S3 pgrb2a byte-range source");
      }
      if (
        batch.selection.variable !== query.variable
        || batch.selection.pressureLevelHpa !== query.pressureLevelHpa
      ) {
        throw new Error("GEFS batched point result changed field selection within one multi-point time-series query");
      }
      if (batch.points.length !== query.points.length) {
        throw new Error("GEFS batched point result changed point count within one multi-point time-series query");
      }

      for (const [pointIndex, point] of batch.points.entries()) {
        const requested = query.points[pointIndex]!;
        const firstPoint = first.points[pointIndex]!;
        if (
          point.requestedPoint.latitude !== requested.latitude
          || point.requestedPoint.longitude !== requested.longitude
        ) {
          throw new Error("GEFS batched point result changed input ordering within one multi-point time-series query");
        }
        if (
          point.gridPoint.latitude !== firstPoint.gridPoint.latitude
          || point.gridPoint.longitude !== firstPoint.gridPoint.longitude
        ) {
          throw new Error(`GEFS grid point changed across forecast steps for requested point index ${pointIndex}`);
        }
      }
    }

    return gefsPointsTimeSeriesResultSchema.parse({
      model: "gefs_0p50",
      run: runIso,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stepHours: 3,
      selection: {
        ...first.selection,
        members,
        quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      },
      includeMembers: query.includeMembers,
      series: batches.map((batch) => ({
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points,
        allCacheHit: batch.source.allCacheHit,
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: batches.every((batch) => batch.source.allCacheHit),
      },
    });
  }
}
