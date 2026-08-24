import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsPointsBundleResultSchema,
  type GefsPointsBundleQueryInput,
  type GefsPointsBundleResult,
} from "../schema/gefs-points-bundle.js";
import {
  gefsPointsBundleTimeSeriesQuerySchema,
  gefsPointsBundleTimeSeriesResultSchema,
  type GefsPointsBundleTimeSeriesQueryInput,
  type GefsPointsBundleTimeSeriesResult,
} from "../schema/gefs-points-bundle-timeseries.js";
import { bundleScalarOutputCount, prepareGefsBundleSelection } from "./gefs-bundle-decoder.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunRangeProvider,
} from "./gefs-latest-run.js";
import { GefsPointsBundleService } from "./gefs-points-bundle.js";
import { gefsForecastHour, nativeGefsValidTimesInRange, parseGefsRun } from "./gefs-time.js";
import { mapConcurrent } from "./concurrency.js";

export const DEFAULT_GEFS_POINTS_BUNDLE_TIME_STEP_CONCURRENCY = 2;

export interface GefsPointsBundleGetter {
  getPoints(query: GefsPointsBundleQueryInput): Promise<GefsPointsBundleResult>;
}

export interface GefsPointsBundleTimeSeriesServiceOptions {
  pointsGetter?: GefsPointsBundleGetter;
  latestRunRangeProvider?: GefsLatestRunRangeProvider;
  stepConcurrency?: number;
}

/**
 * Compose mixed GEFS multi-point bundles across native three-hour valid times.
 * One run is fixed for the complete range. Each step delegates to the
 * multi-point bundle primitive, so upstream selected-file fetches scale with
 * steps × members while local wgrib2 extraction scales with steps × members × points.
 */
export class GefsPointsBundleTimeSeriesService {
  private readonly pointsGetter: GefsPointsBundleGetter;
  private readonly latestRunRangeProvider: GefsLatestRunRangeProvider;
  private readonly stepConcurrency: number;

  constructor(options: GefsPointsBundleTimeSeriesServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new GefsPointsBundleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_POINTS_BUNDLE_TIME_STEP_CONCURRENCY;
  }

  async getPointsTimeSeries(input: GefsPointsBundleTimeSeriesQueryInput): Promise<GefsPointsBundleTimeSeriesResult> {
    const query = gefsPointsBundleTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = prepareGefsBundleSelection(query.selection);
    const times = nativeGefsValidTimesInRange(startTime, endTime, query.maxSteps);

    const pointSteps = query.points.length * times.length;
    if (pointSteps > query.maxPointSteps) {
      throw new Error(
        `Requested GEFS mixed bundle matrix contains ${query.points.length} points × ${times.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${query.maxPointSteps}. Narrow the points/range or raise maxPointSteps.`,
      );
    }

    if (query.includeMembers) {
      const memberSamples = pointSteps * members.length * bundleScalarOutputCount(selection);
      if (memberSamples > query.maxMemberSamples) {
        throw new Error(
          `GEFS multi-point bundle time series would return ${memberSamples} member scalar samples, exceeding maxMemberSamples=${query.maxMemberSamples}`,
        );
      }
    }

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunRange(startTime, endTime, members)
      : parseGefsRun(query.run);

    // Validate both range bounds against the selected cycle before any member
    // downloads. nativeGefsValidTimesInRange already enforces native cadence.
    gefsForecastHour(run, startTime);
    gefsForecastHour(run, endTime);

    const batches = await mapConcurrent(times, this.stepConcurrency, async (validTime) =>
      this.pointsGetter.getPoints({
        points: query.points,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        selection: {
          variables: selection.variables,
          pressureLevelsHpa: selection.pressureLevelsHpa,
          fields: selection.fields,
        },
        members,
        quantiles,
        includeMembers: query.includeMembers,
        maxMemberSamples: query.maxMemberSamples,
      }),
    );

    const first = batches[0];
    if (!first) throw new Error("GEFS multi-point bundle time series produced no forecast steps");
    const runIso = run.toISOString();

    for (const [batchIndex, rawBatch] of batches.entries()) {
      const batch = gefsPointsBundleResultSchema.parse(rawBatch);
      const expectedValidTime = times[batchIndex];
      if (!expectedValidTime) throw new Error("GEFS multi-point bundle time-series internal time alignment failed");
      assertBatchInvariant(batch, {
        runIso,
        validTime: expectedValidTime,
        requestedPoints: query.points,
        first,
        variables: selection.variables,
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: selection.fields,
        members,
        quantiles,
        includeMembers: query.includeMembers,
      });
    }

    return gefsPointsBundleTimeSeriesResultSchema.parse({
      model: "gefs_0p50",
      run: runIso,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stepHours: 3,
      selection: {
        variables: selection.variables,
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: selection.fields,
        members,
        quantiles,
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

function assertBatchInvariant(
  batch: GefsPointsBundleResult,
  expected: {
    runIso: string;
    validTime: Date;
    requestedPoints: readonly { latitude: number; longitude: number }[];
    first: GefsPointsBundleResult;
    variables: readonly string[];
    pressureLevelsHpa: readonly number[];
    fields: readonly string[];
    members: readonly string[];
    quantiles: readonly number[];
    includeMembers: boolean;
  },
): void {
  const expectedValidIso = expected.validTime.toISOString();
  const expectedForecastHour = gefsForecastHour(new Date(expected.runIso), expected.validTime);
  if (
    batch.run !== expected.runIso
    || batch.validTime !== expectedValidIso
    || batch.forecastHour !== expectedForecastHour
  ) {
    throw new Error("GEFS multi-point bundle result changed run or valid time within one time-series query");
  }
  if (
    batch.source.provider !== "NOAA AWS Open Data"
    || batch.source.access !== "s3_range"
    || batch.source.decoder !== "wgrib2"
    || batch.source.product !== "pgrb2a_0p50"
  ) {
    throw new Error("GEFS multi-point bundle time series require the NOAA AWS S3 pgrb2a byte-range source");
  }
  if (
    !sameArray(batch.selection.variables, expected.variables)
    || !sameArray(batch.selection.pressureLevelsHpa, expected.pressureLevelsHpa)
    || !sameArray(batch.selection.fields, expected.fields)
    || !sameArray(batch.selection.members, expected.members)
    || !sameArray(batch.selection.quantiles, expected.quantiles)
  ) {
    throw new Error("GEFS multi-point bundle result changed selection within one time-series query");
  }
  if (batch.points.length !== expected.requestedPoints.length) {
    throw new Error("GEFS multi-point bundle result changed point count within one time-series query");
  }

  for (const [pointIndex, point] of batch.points.entries()) {
    const requested = expected.requestedPoints[pointIndex];
    const firstPoint = expected.first.points[pointIndex];
    if (!requested || !firstPoint) throw new Error("GEFS multi-point bundle time-series point alignment failed");
    if (
      point.requestedPoint.latitude !== requested.latitude
      || point.requestedPoint.longitude !== requested.longitude
    ) {
      throw new Error("GEFS multi-point bundle result changed input ordering within one time-series query");
    }
    if (
      point.gridPoint.latitude !== firstPoint.gridPoint.latitude
      || point.gridPoint.longitude !== firstPoint.gridPoint.longitude
    ) {
      throw new Error(`GEFS grid point changed across forecast steps for mixed bundle point index ${pointIndex}`);
    }
    if (expected.includeMembers && point.members === undefined) {
      throw new Error("GEFS multi-point bundle time-series member payload was requested but omitted by the point service");
    }
  }
}

function sameArray<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
