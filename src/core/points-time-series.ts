import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import {
  pointsTimeSeriesQuerySchema,
  type BatchPointsQueryInput,
  type PointsTimeSeriesQueryInput,
} from "../schema/query.js";
import { BatchPointsService } from "./batch-points.js";
import { mapConcurrent } from "./concurrency.js";
import {
  nativeForecastHoursInRange,
  parseGfsRun,
  validTimeForForecastHour,
} from "./forecast-hour.js";
import {
  LatestRunResolver,
  resolveLatestCompleteRunForGrid,
  resolveLatestRunForGrid,
  type LatestRunProvider,
} from "./latest-run.js";
import type { BatchPointsResult, PointsTimeSeriesResult } from "./types.js";
import type { AtmosphericProgressReporter } from "./progress.js";

export const DEFAULT_POINTS_TIME_SERIES_CONCURRENCY = 4;

export interface BatchPointsGetter {
  getPoints(query: BatchPointsQueryInput): Promise<BatchPointsResult>;
}

export interface PointsTimeSeriesServiceOptions {
  batchPointsGetter?: BatchPointsGetter;
  latestRunProvider?: LatestRunProvider;
  concurrency?: number;
  onProgress?: AtmosphericProgressReporter;
}

/**
 * Multi-point × multi-time GFS access.
 *
 * The service resolves one model run for the complete range, then performs one
 * BatchPointsService call per native forecast step. Each batch therefore reuses
 * a single selected S3 GRIB slice across all requested coordinates rather than
 * issuing point × time independent upstream fetches.
 */
export class PointsTimeSeriesService {
  private readonly latestRunProvider: LatestRunProvider;
  private readonly batchPointsGetter: BatchPointsGetter;
  private readonly concurrency: number;
  private readonly onProgress: AtmosphericProgressReporter | undefined;

  constructor(options: PointsTimeSeriesServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.batchPointsGetter = options.batchPointsGetter ?? new BatchPointsService({
      latestRunProvider: this.latestRunProvider,
    });
    this.concurrency = options.concurrency ?? DEFAULT_POINTS_TIME_SERIES_CONCURRENCY;
    this.onProgress = options.onProgress;
  }

  async getPointsTimeSeries(input: PointsTimeSeriesQueryInput): Promise<PointsTimeSeriesResult> {
    const query = pointsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const variables = expandRequestedVariables(query.variables ?? []);
    const fields = expandRequestedFields(query.fields ?? []);
    const pressureLevelsHpa = query.pressureLevelsHpa ?? [];

    const run = query.run === "latest"
      ? await resolveLatestRunForGrid(this.latestRunProvider, {
          type: "time_range",
          startTime,
          endTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        }, query.grid)
      : query.run === "latest_complete"
        ? await resolveLatestCompleteRunForGrid(this.latestRunProvider, query.grid)
        : parseGfsRun(query.run);

    const forecastHours = nativeForecastHoursInRange(run, startTime, endTime, query.grid);
    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested time range contains ${forecastHours.length} native GFS outputs, exceeding maxSteps=${query.maxSteps}. Narrow the range or raise maxSteps.`,
      );
    }

    const samples = query.points.length * forecastHours.length;
    if (samples > query.maxSamples) {
      throw new Error(
        `Requested matrix contains ${query.points.length} points × ${forecastHours.length} steps = ${samples} point-steps, exceeding maxSamples=${query.maxSamples}. Narrow the points/range or raise maxSamples.`,
      );
    }

    this.onProgress?.({
      dataset: "gfs",
      operation: "points_time_series",
      phase: "start",
      completedSteps: 0,
      totalSteps: forecastHours.length,
      source: "s3",
    });

    let completedSteps = 0;
    const batches = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHourValue) => {
        const validTime = validTimeForForecastHour(run, forecastHourValue).toISOString();
        const batch = await this.batchPointsGetter.getPoints({
          points: query.points,
          run: run.toISOString(),
          ...(query.grid === undefined ? {} : { grid: query.grid }),
          validTime,
          ...(query.variables === undefined ? {} : { variables: query.variables }),
          ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
          ...(query.fields === undefined ? {} : { fields: query.fields }),
        });
        completedSteps += 1;
        this.onProgress?.({
          dataset: "gfs",
          operation: "points_time_series",
          phase: "step",
          completedSteps,
          totalSteps: forecastHours.length,
          source: "s3",
          forecastHour: forecastHourValue,
          validTime,
          cacheHit: batch.source.cacheHit,
        });
        return batch;
      },
    );

    const first = batches[0];
    if (!first) throw new Error("No native GFS outputs fall inside the requested multi-point time range");

    for (const [batchIndex, batch] of batches.entries()) {
      const expectedForecastHour = forecastHours[batchIndex]!;
      const expectedValidTime = validTimeForForecastHour(run, expectedForecastHour).toISOString();
      if (
        batch.run !== run.toISOString()
        || batch.forecastHour !== expectedForecastHour
        || batch.validTime !== expectedValidTime
      ) {
        throw new Error("Batched point result changed run or valid time within one multi-point time-series query");
      }
      if (
        batch.source.provider !== "NOAA AWS Open Data"
        || batch.source.access !== "s3_range"
        || batch.source.decoder !== first.source.decoder
      ) {
        throw new Error("Multi-point time series require the NOAA AWS S3 byte-range source");
      }
      if (batch.points.length !== query.points.length) {
        throw new Error("Batched point result changed point count within one multi-point time-series query");
      }
      for (const [pointIndex, point] of batch.points.entries()) {
        const requested = query.points[pointIndex]!;
        const firstPoint = first.points[pointIndex]!;
        if (
          point.requestedPoint.latitude !== requested.latitude
          || point.requestedPoint.longitude !== requested.longitude
        ) {
          throw new Error("Batched point result changed input ordering within one multi-point time-series query");
        }
        if (
          point.gridPoint.latitude !== firstPoint.gridPoint.latitude
          || point.gridPoint.longitude !== firstPoint.gridPoint.longitude
        ) {
          throw new Error("GFS grid point changed across forecast steps for one requested point");
        }
      }
    }

    this.onProgress?.({
      dataset: "gfs",
      operation: "points_time_series",
      phase: "complete",
      completedSteps: forecastHours.length,
      totalSteps: forecastHours.length,
      source: "s3",
    });

    return {
      model: first.model,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: first.source.decoder,
      },
      series: batches.map((batch) => ({
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points,
        cacheHit: batch.source.cacheHit,
      })),
    };
  }
}
