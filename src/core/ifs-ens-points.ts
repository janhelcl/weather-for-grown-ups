import { NON_ISOBARIC_FIELD_CATALOG } from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
} from "../catalog/ifs-ens.js";
import {
  ifsEnsPointsQuerySchema,
  ifsEnsPointsResultSchema,
  ifsEnsPointsTimeSeriesQuerySchema,
  ifsEnsPointsTimeSeriesResultSchema,
  type IfsEnsPointsQueryInput,
  type IfsEnsPointsResult,
  type IfsEnsPointsTimeSeriesQueryInput,
  type IfsEnsPointsTimeSeriesResult,
} from "../schema/ifs-ens-points.js";
import type {
  IfsEnsMemberBundleQueryInput,
  IfsEnsMemberBundleResult,
  IfsEnsSelection,
} from "../schema/ifs-ens.js";
import { mapConcurrent } from "./concurrency.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRangeRunProvider,
  type IfsEnsLatestRunProvider,
} from "./ifs-ens-latest-run.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHour,
  ifsEnsForecastHoursInRange,
  ifsEnsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";

export const DEFAULT_IFS_ENS_POINT_CONCURRENCY = 4;
export const DEFAULT_IFS_ENS_POINTS_TIME_STEP_CONCURRENCY = 2;

export interface IfsEnsPointsBundleGetter {
  getBundle(query: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface IfsEnsPointsServiceOptions {
  bundleGetter?: IfsEnsPointsBundleGetter;
  latestRunProvider?: IfsEnsLatestRunProvider;
  pointConcurrency?: number;
}

export class IfsEnsPointsService {
  private readonly bundleGetter: IfsEnsPointsBundleGetter;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly pointConcurrency: number;

  constructor(options: IfsEnsPointsServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService();
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver();
    this.pointConcurrency = options.pointConcurrency ?? DEFAULT_IFS_ENS_POINT_CONCURRENCY;
  }

  async getPoints(input: IfsEnsPointsQueryInput): Promise<IfsEnsPointsResult> {
    const query = ifsEnsPointsQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    guardMemberPayload(
      query.includeMembers,
      query.points.length,
      members.length,
      query.selection,
      query.maxMemberSamples,
      "IFS ENS multi-point bundle",
    );

    const selectors = availabilitySelectors(query.selection, members);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, selectors)
      : parseIfsRun(query.run);
    const forecastHour = ifsEnsForecastHour(run, validTime);
    const runIso = run.toISOString();
    const validIso = validTime.toISOString();

    const bundles = await mapConcurrent(query.points, this.pointConcurrency, async (point) =>
      this.bundleGetter.getBundle({
        latitude: point.latitude,
        longitude: point.longitude,
        run: runIso,
        validTime: validIso,
        selection: query.selection,
        members,
        quantiles,
        includeMembers: query.includeMembers,
      }));

    const first = bundles[0];
    if (!first) throw new Error("IFS ENS multi-point query produced no point bundles");
    for (const [index, bundle] of bundles.entries()) {
      const requested = query.points[index];
      if (!requested) throw new Error("IFS ENS multi-point request alignment failed");
      assertPointBundleInvariant(bundle, {
        runIso,
        validIso,
        forecastHour,
        requested,
        first,
        members,
        quantiles,
        selection: query.selection,
        includeMembers: query.includeMembers,
      });
    }

    return ifsEnsPointsResultSchema.parse({
      model: "ifs_ens_0p25",
      run: runIso,
      validTime: validIso,
      forecastHour,
      selection: first.selection,
      includeMembers: query.includeMembers,
      points: bundles.map((bundle) => ({
        requestedPoint: bundle.requestedPoint,
        gridPoint: bundle.gridPoint,
        pressureSummaries: bundle.pressureSummaries,
        fieldSummaries: bundle.fieldSummaries,
        ...(bundle.members === undefined ? {} : { members: bundle.members }),
        allCacheHit: bundle.source.allCacheHit,
      })),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: bundles.every((bundle) => bundle.source.allCacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}

export interface IfsEnsPointsTimeSeriesServiceOptions extends IfsEnsPointsServiceOptions {
  pointsGetter?: Pick<IfsEnsPointsService, "getPoints">;
  latestRunRangeProvider?: IfsEnsLatestRangeRunProvider;
  stepConcurrency?: number;
}

export class IfsEnsPointsTimeSeriesService {
  private readonly pointsGetter: Pick<IfsEnsPointsService, "getPoints">;
  private readonly latestRunRangeProvider: IfsEnsLatestRangeRunProvider;
  private readonly stepConcurrency: number;

  constructor(options: IfsEnsPointsTimeSeriesServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new IfsEnsPointsService(options);
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsEnsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_IFS_ENS_POINTS_TIME_STEP_CONCURRENCY;
  }

  async getPointsTimeSeries(
    input: IfsEnsPointsTimeSeriesQueryInput,
  ): Promise<IfsEnsPointsTimeSeriesResult> {
    const query = ifsEnsPointsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selectors = availabilitySelectors(query.selection, members);

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunForRange(startTime, endTime, selectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsEnsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested IFS ENS multi-point time range contains ${forecastHours.length} native outputs, exceeding maxSteps=${query.maxSteps}`,
      );
    }
    const pointSteps = query.points.length * forecastHours.length;
    if (pointSteps > query.maxPointSteps) {
      throw new Error(
        `Requested IFS ENS multi-point time series contains ${query.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${query.maxPointSteps}`,
      );
    }
    guardMemberPayload(
      query.includeMembers,
      pointSteps,
      members.length,
      query.selection,
      query.maxMemberSamples,
      "IFS ENS multi-point time series",
    );

    const runIso = run.toISOString();
    const batches = await mapConcurrent(forecastHours, this.stepConcurrency, async (forecastHour) =>
      this.pointsGetter.getPoints({
        points: query.points,
        run: runIso,
        validTime: ifsEnsValidTimeForForecastHour(run, forecastHour).toISOString(),
        selection: query.selection,
        members,
        quantiles,
        includeMembers: query.includeMembers,
        maxMemberSamples: query.maxMemberSamples,
      }));

    const first = batches[0];
    if (!first) throw new Error("IFS ENS multi-point time series produced no forecast steps");
    for (const [index, batch] of batches.entries()) {
      const forecastHour = forecastHours[index];
      if (forecastHour === undefined) throw new Error("IFS ENS multi-point time alignment failed");
      assertBatchInvariant(batch, {
        run,
        forecastHour,
        requestedPoints: query.points,
        first,
        members,
        quantiles,
        selection: query.selection,
        includeMembers: query.includeMembers,
      });
    }

    return ifsEnsPointsTimeSeriesResultSchema.parse({
      model: "ifs_ens_0p25",
      run: runIso,
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      cadence: "ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z",
      selection: first.selection,
      includeMembers: query.includeMembers,
      series: batches.map((batch) => ({
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points,
        allCacheHit: batch.source.allCacheHit,
      })),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: batches.every((batch) => batch.source.allCacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}

function availabilitySelectors(
  selection: IfsEnsSelection,
  members: readonly ReturnType<typeof sortIfsEnsMembers>[number][],
) {
  const base = ifsIndexSelectorsForSelection(selection);
  return members.flatMap((member) => {
    const number = ifsEnsMemberNumber(member);
    return base.map((selector) => ({ ...selector, number }));
  });
}

function scalarOutputCount(selection: IfsEnsSelection): number {
  const pressureOutputs = selection.pressureLevelsHpa.length
    * selection.variables.reduce((sum, variable) => sum + VARIABLE_CATALOG[variable].outputs.length, 0);
  const fieldOutputs = selection.fields.reduce(
    (sum, field) => sum + NON_ISOBARIC_FIELD_CATALOG[field].outputs.length,
    0,
  );
  return pressureOutputs + fieldOutputs;
}

function guardMemberPayload(
  includeMembers: boolean,
  pointSteps: number,
  memberCount: number,
  selection: IfsEnsSelection,
  maxMemberSamples: number,
  label: string,
): void {
  if (!includeMembers) return;
  const count = pointSteps * memberCount * scalarOutputCount(selection);
  if (count > maxMemberSamples) {
    throw new Error(
      `${label} would return ${count} member scalar samples, exceeding maxMemberSamples=${maxMemberSamples}`,
    );
  }
}

function assertPointBundleInvariant(
  bundle: IfsEnsMemberBundleResult,
  expected: {
    runIso: string;
    validIso: string;
    forecastHour: number;
    requested: { latitude: number; longitude: number };
    first: IfsEnsMemberBundleResult;
    members: readonly string[];
    quantiles: readonly number[];
    selection: IfsEnsSelection;
    includeMembers: boolean;
  },
): void {
  if (
    bundle.run !== expected.runIso
    || bundle.validTime !== expected.validIso
    || bundle.forecastHour !== expected.forecastHour
  ) {
    throw new Error("IFS ENS multi-point bundle changed run or valid time within one query");
  }
  if (
    bundle.requestedPoint.latitude !== expected.requested.latitude
    || bundle.requestedPoint.longitude !== expected.requested.longitude
  ) {
    throw new Error("IFS ENS multi-point bundle changed requested point ordering");
  }
  assertStableSelection(bundle, expected.members, expected.quantiles, expected.selection);
  assertStableSource(bundle, expected.first);
  if (expected.includeMembers && bundle.members === undefined) {
    throw new Error("IFS ENS multi-point member payload was requested but omitted");
  }
}

function assertBatchInvariant(
  batch: IfsEnsPointsResult,
  expected: {
    run: Date;
    forecastHour: number;
    requestedPoints: readonly { latitude: number; longitude: number }[];
    first: IfsEnsPointsResult;
    members: readonly string[];
    quantiles: readonly number[];
    selection: IfsEnsSelection;
    includeMembers: boolean;
  },
): void {
  const validTime = ifsEnsValidTimeForForecastHour(expected.run, expected.forecastHour).toISOString();
  if (
    batch.run !== expected.run.toISOString()
    || batch.validTime !== validTime
    || batch.forecastHour !== expected.forecastHour
  ) {
    throw new Error("IFS ENS multi-point result changed run or valid time within one time-series query");
  }
  if (batch.points.length !== expected.requestedPoints.length) {
    throw new Error("IFS ENS multi-point result changed point count within one time-series query");
  }
  if (
    batch.source.decoder !== expected.first.source.decoder
    || batch.source.product !== expected.first.source.product
    || batch.source.horizontalGridDegrees !== expected.first.source.horizontalGridDegrees
    || batch.source.memberSemantics !== expected.first.source.memberSemantics
  ) {
    throw new Error("IFS ENS multi-point source provenance changed within one time-series query");
  }
  assertStableSelection(
    batch,
    expected.members,
    expected.quantiles,
    expected.selection,
  );

  for (const [pointIndex, point] of batch.points.entries()) {
    const requested = expected.requestedPoints[pointIndex];
    const firstPoint = expected.first.points[pointIndex];
    if (!requested || !firstPoint) throw new Error("IFS ENS multi-point time-series point alignment failed");
    if (
      point.requestedPoint.latitude !== requested.latitude
      || point.requestedPoint.longitude !== requested.longitude
    ) {
      throw new Error("IFS ENS multi-point result changed input ordering within one time-series query");
    }
    if (
      point.gridPoint.latitude !== firstPoint.gridPoint.latitude
      || point.gridPoint.longitude !== firstPoint.gridPoint.longitude
    ) {
      throw new Error(`IFS ENS grid point changed across forecast steps for point index ${pointIndex}`);
    }
    if (expected.includeMembers && point.members === undefined) {
      throw new Error("IFS ENS multi-point time-series member payload was requested but omitted");
    }
  }
}

function assertStableSelection(
  bundle: Pick<IfsEnsMemberBundleResult, "selection">,
  members: readonly string[],
  quantiles: readonly number[],
  selection: IfsEnsSelection,
): void {
  if (
    !sameArray(bundle.selection.variables, selection.variables)
    || !sameArray(bundle.selection.pressureLevelsHpa, [...selection.pressureLevelsHpa].sort((a, b) => b - a))
    || !sameArray(bundle.selection.fields, selection.fields)
    || !sameArray(bundle.selection.members, members)
    || !sameArray(bundle.selection.quantiles, quantiles)
  ) {
    throw new Error("IFS ENS multi-point result changed ensemble selection");
  }
}

function assertStableSource(
  bundle: IfsEnsMemberBundleResult,
  first: IfsEnsMemberBundleResult,
): void {
  if (
    bundle.source.provider !== "ECMWF Open Data"
    || bundle.source.access !== "indexed_http_range"
    || bundle.source.decoder !== first.source.decoder
    || bundle.source.product !== "ifs_0p25_enfo_ef"
    || bundle.source.horizontalGridDegrees !== 0.25
    || bundle.source.memberSemantics !== first.source.memberSemantics
  ) {
    throw new Error("IFS ENS multi-point query requires consistent ECMWF ensemble provenance");
  }
}

function sameArray<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
