import { GEFS_PGRB2A_FIELD_CATALOG } from "../catalog/gefs-fields.js";
import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsBundleTimeSeriesQuerySchema,
  gefsBundleTimeSeriesResultSchema,
  type GefsBundleTimeSeriesQueryInput,
  type GefsBundleTimeSeriesResult,
} from "../schema/gefs-bundle-timeseries.js";
import type {
  GefsMemberBundleQueryInput,
  GefsMemberBundleResult,
} from "../schema/gefs-member-bundle.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsMemberBundleService } from "./gefs-member-bundle.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunRangeProvider,
} from "./gefs-latest-run.js";
import {
  gefsForecastHour,
  nativeGefsValidTimesInRange,
  parseGefsRun,
} from "./gefs-time.js";
import {
  gefsAtmosProductForSelection,
  type GefsAtmosProduct,
} from "../sources/gefs-s3.js";
import { InvalidRequestError } from "../failure.js";

export const DEFAULT_GEFS_BUNDLE_TIME_STEP_CONCURRENCY = 2;

export interface GefsMemberBundleGetter {
  getBundle(query: GefsMemberBundleQueryInput, productOverride?: GefsAtmosProduct): Promise<GefsMemberBundleResult>;
}

export interface GefsBundleTimeSeriesServiceOptions {
  bundleGetter?: GefsMemberBundleGetter;
  latestRunRangeProvider?: GefsLatestRunRangeProvider;
  stepConcurrency?: number;
}

export class GefsBundleTimeSeriesService {
  private readonly bundleGetter: GefsMemberBundleGetter;
  private readonly latestRunRangeProvider: GefsLatestRunRangeProvider;
  private readonly stepConcurrency: number;

  constructor(options: GefsBundleTimeSeriesServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new GefsMemberBundleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_BUNDLE_TIME_STEP_CONCURRENCY;
  }

  async getTimeSeries(input: GefsBundleTimeSeriesQueryInput): Promise<GefsBundleTimeSeriesResult> {
    const query = gefsBundleTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = {
      variables: [...query.selection.variables],
      pressureLevelsHpa: [...query.selection.pressureLevelsHpa].sort((a, b) => b - a),
      fields: [...query.selection.fields],
    };
    const times = nativeGefsValidTimesInRange(startTime, endTime, query.maxSteps);

    if (query.includeMembers) {
      const scalarOutputsPerMemberStep = selection.variables.length * selection.pressureLevelsHpa.length
        + selection.fields.reduce((sum, id) => sum + GEFS_PGRB2A_FIELD_CATALOG[id].outputs.length, 0);
      const memberSamples = times.length * members.length * scalarOutputsPerMemberStep;
      if (memberSamples > query.maxMemberSamples) {
        throw new InvalidRequestError(
          `GEFS bundle time series would return ${memberSamples} member scalar samples, exceeding maxMemberSamples=${query.maxMemberSamples}`,
        );
      }
    }

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunRange(startTime, endTime, members)
      : parseGefsRun(query.run);
    gefsForecastHour(run, startTime);
    const endForecastHour = gefsForecastHour(run, endTime);
    const product = gefsAtmosProductForSelection(selection.variables.length > 0, endForecastHour);

    const results = await mapConcurrent(times, this.stepConcurrency, async (validTime) =>
      this.bundleGetter.getBundle({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        selection,
        members,
        quantiles,
        includeMembers: query.includeMembers,
      }, product),
    );

    const first = results[0];
    if (!first) throw new Error("GEFS bundle time series produced no forecast steps");
    const expectedRun = run.toISOString();
    for (const [index, result] of results.entries()) {
      const expectedTime = times[index];
      if (!expectedTime) throw new Error("GEFS bundle time-series internal time alignment failed");
      assertInvariant(result, expectedRun, expectedTime, first.gridPoint);
      if (
        result.source.product !== first.source.product
        || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
      ) {
        throw new Error("GEFS bundle time series changed source product or horizontal grid within one range");
      }
      if (query.includeMembers && result.members === undefined) {
        throw new Error("GEFS bundle time-series member payload was requested but omitted by the bundle service");
      }
    }

    return gefsBundleTimeSeriesResultSchema.parse({
      model: "gefs_0p50",
      run: expectedRun,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stepHours: 3,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: { ...selection, members, quantiles },
      includeMembers: query.includeMembers,
      series: results.map((result) => ({
        validTime: result.validTime,
        forecastHour: result.forecastHour,
        pressureSummaries: result.pressureSummaries,
        fieldSummaries: result.fieldSummaries,
        ...(query.includeMembers ? { members: result.members } : {}),
        allCacheHit: result.source.allCacheHit,
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: results[0]!.source.decoder,
        product: first.source.product,
        horizontalGridDegrees: first.source.horizontalGridDegrees,
        allCacheHit: results.every((result) => result.source.allCacheHit),
      },
    });
  }
}

function assertInvariant(
  result: GefsMemberBundleResult,
  expectedRun: string,
  expectedValidTime: Date,
  expectedGridPoint: { latitude: number; longitude: number },
): void {
  const expectedValidIso = expectedValidTime.toISOString();
  const expectedForecastHour = gefsForecastHour(new Date(expectedRun), expectedValidTime);
  if (result.run !== expectedRun) throw new Error("GEFS bundle time series drifted between model runs");
  if (result.validTime !== expectedValidIso || result.forecastHour !== expectedForecastHour) {
    throw new Error("GEFS bundle time-series step returned inconsistent valid time or forecast hour");
  }
  if (
    result.gridPoint.latitude !== expectedGridPoint.latitude
    || result.gridPoint.longitude !== expectedGridPoint.longitude
  ) {
    throw new Error("GEFS bundle time-series steps resolved to inconsistent grid points");
  }
}
