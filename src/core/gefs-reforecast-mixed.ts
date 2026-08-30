import { sortGefsMembers } from "../catalog/gefs.js";
import type { GefsReforecastMember } from "../catalog/gefs-reforecast.js";
import {
  gefsReforecastMixedPointQuerySchema,
  gefsReforecastMixedPointResultSchema,
  gefsReforecastMixedPointsQuerySchema,
  gefsReforecastMixedPointsResultSchema,
  gefsReforecastMixedTimeSeriesQuerySchema,
  gefsReforecastMixedTimeSeriesResultSchema,
  gefsReforecastMixedPointsTimeSeriesQuerySchema,
  gefsReforecastMixedPointsTimeSeriesResultSchema,
  type GefsReforecastMixedPointQueryInput,
  type GefsReforecastMixedPointResult,
  type GefsReforecastMixedPointsQueryInput,
  type GefsReforecastMixedPointsResult,
  type GefsReforecastMixedTimeSeriesQueryInput,
  type GefsReforecastMixedTimeSeriesResult,
  type GefsReforecastMixedPointsTimeSeriesQueryInput,
  type GefsReforecastMixedPointsTimeSeriesResult,
} from "../schema/gefs-reforecast-mixed.js";
import {
  gefsReforecastForecastHour,
  nativeGefsReforecastValidTimesInRange,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  bundleScalarOutputCount,
  prepareGefsBundleSelection,
} from "./gefs-bundle-decoder.js";
import { GefsReforecastProfileService } from "./gefs-reforecast-profile.js";
import { GefsReforecastPointService } from "./gefs-reforecast.js";

export const DEFAULT_GEFS_REFORECAST_MIXED_POINT_CONCURRENCY = 4;
export const DEFAULT_GEFS_REFORECAST_MIXED_TIME_CONCURRENCY = 2;

type ProfileGetter = Pick<GefsReforecastProfileService, "getProfile">;
type FieldGetter = Pick<GefsReforecastPointService, "getPoint">;

export interface GefsReforecastMixedPointServiceOptions {
  profileGetter?: ProfileGetter;
  fieldGetter?: FieldGetter;
}

export class GefsReforecastMixedPointService {
  private readonly profileGetter: ProfileGetter;
  private readonly fieldGetter: FieldGetter;

  constructor(options: GefsReforecastMixedPointServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new GefsReforecastProfileService();
    this.fieldGetter = options.fieldGetter ?? new GefsReforecastPointService();
  }

  async getPoint(
    input: GefsReforecastMixedPointQueryInput,
  ): Promise<GefsReforecastMixedPointResult> {
    const query = gefsReforecastMixedPointQuerySchema.parse(input);
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const common = {
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      members,
      quantiles,
      includeMembers: query.includeMembers,
    };

    const [pressure, fields] = await Promise.all([
      this.profileGetter.getProfile({
        ...common,
        variables: [...query.variables],
        pressureLevelsHpa,
      }),
      this.fieldGetter.getPoint({
        ...common,
        fields: [...query.fields],
      }),
    ]);

    assertMixedPairInvariants(pressure, fields, {
      latitude: query.latitude,
      longitude: query.longitude,
      members,
      quantiles,
      variables: query.variables,
      pressureLevelsHpa,
      fields: query.fields,
      includeMembers: query.includeMembers,
    });

    return gefsReforecastMixedPointResultSchema.parse({
      model: "gefs_v12_reforecast",
      kind: "mixed",
      run: pressure.run,
      validTime: pressure.validTime,
      forecastHour: pressure.forecastHour,
      requestedPoint: pressure.requestedPoint,
      selection: {
        variables: [...query.variables],
        pressureLevelsHpa,
        fields: [...query.fields],
        members,
        quantiles,
      },
      pressure: {
        gridPoint: pressure.gridPoint,
        summaries: pressure.summaries,
        ...(pressure.members === undefined ? {} : { members: pressure.members }),
        source: {
          horizontalGridDegrees: pressure.source.horizontalGridDegrees,
          profileGridPolicy: pressure.source.profileGridPolicy,
          allCacheHit: pressure.source.allCacheHit,
        },
      },
      fields: {
        gridPoint: fields.gridPoint,
        fieldSummaries: fields.fieldSummaries,
        ...(fields.members === undefined ? {} : { members: fields.members }),
        source: {
          horizontalGridDegrees: fields.source.horizontalGridDegrees,
          allCacheHit: fields.source.allCacheHit,
        },
      },
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: pressure.source.decoder,
        archiveType: "reforecast",
        dataset: "GEFSv12/reforecast",
        leadBlock: pressure.source.leadBlock,
        gridSemantics: "pressure_and_field_grids_reported_separately",
        allCacheHit: pressure.source.allCacheHit && fields.source.allCacheHit,
      },
    });
  }
}

export interface GefsReforecastMixedPointsServiceOptions {
  pointGetter?: Pick<GefsReforecastMixedPointService, "getPoint">;
  pointConcurrency?: number;
}

export class GefsReforecastMixedPointsService {
  private readonly pointGetter: Pick<GefsReforecastMixedPointService, "getPoint">;
  private readonly pointConcurrency: number;

  constructor(options: GefsReforecastMixedPointsServiceOptions = {}) {
    this.pointGetter = options.pointGetter ?? new GefsReforecastMixedPointService();
    this.pointConcurrency =
      options.pointConcurrency ?? DEFAULT_GEFS_REFORECAST_MIXED_POINT_CONCURRENCY;
  }

  async getPoints(
    input: GefsReforecastMixedPointsQueryInput,
  ): Promise<GefsReforecastMixedPointsResult> {
    const query = gefsReforecastMixedPointsQuerySchema.parse(input);
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    assertMixedMemberSampleLimit(query, members.length);

    const results = await mapConcurrent(
      query.points,
      this.pointConcurrency,
      async (point) => this.pointGetter.getPoint({
        ...point,
        run: query.run,
        validTime: query.validTime,
        variables: [...query.variables],
        pressureLevelsHpa,
        fields: [...query.fields],
        members,
        quantiles,
        includeMembers: query.includeMembers,
      }),
    );
    const first = assertMixedPointBatchInvariants(query.points, results);

    return gefsReforecastMixedPointsResultSchema.parse({
      model: "gefs_v12_reforecast",
      kind: "mixed",
      run: first.run,
      validTime: first.validTime,
      forecastHour: first.forecastHour,
      selection: first.selection,
      includeMembers: query.includeMembers,
      points: results.map((result) => ({
        requestedPoint: result.requestedPoint,
        pressure: result.pressure,
        fields: result.fields,
      })),
      source: {
        ...first.source,
        allCacheHit: results.every((result) => result.source.allCacheHit),
      },
    });
  }
}

export interface GefsReforecastMixedTimeSeriesServiceOptions {
  pointGetter?: Pick<GefsReforecastMixedPointService, "getPoint">;
  stepConcurrency?: number;
}

export class GefsReforecastMixedTimeSeriesService {
  private readonly pointGetter: Pick<GefsReforecastMixedPointService, "getPoint">;
  private readonly stepConcurrency: number;

  constructor(options: GefsReforecastMixedTimeSeriesServiceOptions = {}) {
    this.pointGetter = options.pointGetter ?? new GefsReforecastMixedPointService();
    this.stepConcurrency =
      options.stepConcurrency ?? DEFAULT_GEFS_REFORECAST_MIXED_TIME_CONCURRENCY;
  }

  async getTimeSeries(
    input: GefsReforecastMixedTimeSeriesQueryInput,
  ): Promise<GefsReforecastMixedTimeSeriesResult> {
    const query = gefsReforecastMixedTimeSeriesQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      startTime,
      endTime,
      query.maxSteps,
    );
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);

    const results = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime) => this.pointGetter.getPoint({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        variables: [...query.variables],
        pressureLevelsHpa,
        fields: [...query.fields],
        members,
        quantiles,
        includeMembers: false,
      }),
    );
    const first = assertMixedTimeInvariants(run, times, results);

    return gefsReforecastMixedTimeSeriesResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      requestedPoint: first.requestedPoint,
      selection: first.selection,
      series: results.map((result) => ({
        kind: "mixed",
        validTime: result.validTime,
        forecastHour: result.forecastHour,
        pressure: withoutMembers(result.pressure),
        fields: withoutMembers(result.fields),
      })),
      source: rangeSourceSummary(
        first.source.decoder,
        results.every((result) => result.source.allCacheHit),
      ),
    });
  }
}

export interface GefsReforecastMixedPointsTimeSeriesServiceOptions {
  pointsGetter?: Pick<GefsReforecastMixedPointsService, "getPoints">;
  stepConcurrency?: number;
}

export class GefsReforecastMixedPointsTimeSeriesService {
  private readonly pointsGetter: Pick<GefsReforecastMixedPointsService, "getPoints">;
  private readonly stepConcurrency: number;

  constructor(options: GefsReforecastMixedPointsTimeSeriesServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new GefsReforecastMixedPointsService();
    this.stepConcurrency =
      options.stepConcurrency ?? DEFAULT_GEFS_REFORECAST_MIXED_TIME_CONCURRENCY;
  }

  async getPointsTimeSeries(
    input: GefsReforecastMixedPointsTimeSeriesQueryInput,
  ): Promise<GefsReforecastMixedPointsTimeSeriesResult> {
    const query = gefsReforecastMixedPointsTimeSeriesQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      startTime,
      endTime,
      query.maxSteps,
    );
    const pointSteps = query.points.length * times.length;
    if (pointSteps > query.maxPointSteps) {
      throw new Error(
        `GEFSv12 reforecast mixed multi-point range contains ${query.points.length} points × ${times.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${query.maxPointSteps}`,
      );
    }
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);

    const batches = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime) => this.pointsGetter.getPoints({
        points: query.points,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        variables: [...query.variables],
        pressureLevelsHpa,
        fields: [...query.fields],
        members,
        quantiles,
        includeMembers: false,
      }),
    );
    const first = assertMixedBatchTimeInvariants(run, times, query.points, batches);

    return gefsReforecastMixedPointsTimeSeriesResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      selection: first.selection,
      series: batches.map((batch) => ({
        kind: "mixed",
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points.map((point) => ({
          requestedPoint: point.requestedPoint,
          pressure: withoutMembers(point.pressure),
          fields: withoutMembers(point.fields),
        })),
        source: {
          leadBlock: batch.source.leadBlock,
          allCacheHit: batch.source.allCacheHit,
        },
      })),
      source: rangeSourceSummary(
        first.source.decoder,
        batches.every((batch) => batch.source.allCacheHit),
      ),
    });
  }
}

function assertMixedPairInvariants(
  pressure: Awaited<ReturnType<ProfileGetter["getProfile"]>>,
  fields: Awaited<ReturnType<FieldGetter["getPoint"]>>,
  expected: {
    latitude: number;
    longitude: number;
    members: readonly string[];
    quantiles: readonly number[];
    variables: readonly string[];
    pressureLevelsHpa: readonly number[];
    fields: readonly string[];
    includeMembers: boolean;
  },
): void {
  if (
    pressure.run !== fields.run
    || pressure.validTime !== fields.validTime
    || pressure.forecastHour !== fields.forecastHour
  ) {
    throw new Error("GEFSv12 reforecast mixed query returned inconsistent run or valid-time metadata");
  }
  if (
    pressure.requestedPoint.latitude !== expected.latitude
    || pressure.requestedPoint.longitude !== expected.longitude
    || fields.requestedPoint.latitude !== expected.latitude
    || fields.requestedPoint.longitude !== expected.longitude
  ) {
    throw new Error("GEFSv12 reforecast mixed query changed the requested point");
  }
  if (pressure.source.decoder !== fields.source.decoder) {
    throw new Error("GEFSv12 reforecast mixed query used different decoders for pressure and fields");
  }
  if (pressure.source.leadBlock !== fields.source.leadBlock) {
    throw new Error("GEFSv12 reforecast mixed query used inconsistent retrospective lead blocks");
  }
  if (
    !sameArray(pressure.selection.members, expected.members)
    || !sameArray(fields.selection.members, expected.members)
    || !sameArray(pressure.selection.quantiles, expected.quantiles)
    || !sameArray(fields.selection.quantiles, expected.quantiles)
    || !sameArray(pressure.selection.variables, expected.variables)
    || !sameArray(pressure.selection.pressureLevelsHpa, expected.pressureLevelsHpa)
    || !sameArray(fields.selection.fields, expected.fields)
  ) {
    throw new Error("GEFSv12 reforecast mixed query changed selection between pressure and field branches");
  }
  if (expected.includeMembers && (pressure.members === undefined || fields.members === undefined)) {
    throw new Error("GEFSv12 reforecast mixed query omitted requested member payloads");
  }
}

function assertMixedPointBatchInvariants(
  requestedPoints: Array<{ latitude: number; longitude: number }>,
  results: GefsReforecastMixedPointResult[],
): GefsReforecastMixedPointResult {
  const first = results[0];
  if (!first) throw new Error("GEFSv12 reforecast mixed multi-point query produced no points");
  for (const [index, result] of results.entries()) {
    const requested = requestedPoints[index];
    if (!requested) throw new Error("GEFSv12 reforecast mixed point alignment failed");
    if (
      result.run !== first.run
      || result.validTime !== first.validTime
      || result.forecastHour !== first.forecastHour
      || result.requestedPoint.latitude !== requested.latitude
      || result.requestedPoint.longitude !== requested.longitude
      || result.source.decoder !== first.source.decoder
      || result.source.leadBlock !== first.source.leadBlock
      || !sameMixedSelection(result.selection, first.selection)
    ) {
      throw new Error("GEFSv12 reforecast mixed multi-point query changed shared semantics between points");
    }
  }
  return first;
}

function assertMixedTimeInvariants(
  run: Date,
  times: Date[],
  results: GefsReforecastMixedPointResult[],
): GefsReforecastMixedPointResult {
  const first = results[0];
  if (!first) throw new Error("GEFSv12 reforecast mixed time series produced no steps");
  for (const [index, result] of results.entries()) {
    const expected = times[index];
    if (
      !expected
      || result.run !== run.toISOString()
      || result.validTime !== expected.toISOString()
      || result.forecastHour !== gefsReforecastForecastHour(run, expected)
      || result.source.decoder !== first.source.decoder
      || !sameMixedSelection(result.selection, first.selection)
    ) {
      throw new Error("GEFSv12 reforecast mixed time series changed shared semantics between steps");
    }
  }
  return first;
}

function assertMixedBatchTimeInvariants(
  run: Date,
  times: Date[],
  requestedPoints: Array<{ latitude: number; longitude: number }>,
  batches: GefsReforecastMixedPointsResult[],
): GefsReforecastMixedPointsResult {
  const first = batches[0];
  if (!first) throw new Error("GEFSv12 reforecast mixed multi-point range produced no steps");
  for (const [index, batch] of batches.entries()) {
    const expected = times[index];
    if (
      !expected
      || batch.run !== run.toISOString()
      || batch.validTime !== expected.toISOString()
      || batch.forecastHour !== gefsReforecastForecastHour(run, expected)
      || batch.points.length !== requestedPoints.length
      || batch.source.decoder !== first.source.decoder
      || !sameMixedSelection(batch.selection, first.selection)
    ) {
      throw new Error("GEFSv12 reforecast mixed multi-point range changed shared semantics between steps");
    }
    for (const [pointIndex, point] of batch.points.entries()) {
      const requested = requestedPoints[pointIndex];
      if (
        !requested
        || point.requestedPoint.latitude !== requested.latitude
        || point.requestedPoint.longitude !== requested.longitude
      ) {
        throw new Error("GEFSv12 reforecast mixed multi-point range changed point ordering");
      }
    }
  }
  return first;
}

function assertMixedMemberSampleLimit(
  query: ReturnType<typeof gefsReforecastMixedPointsQuerySchema.parse>,
  memberCount: number,
): void {
  if (!query.includeMembers) return;
  const fieldScalarOutputs = bundleScalarOutputCount(prepareGefsBundleSelection({
    variables: [],
    pressureLevelsHpa: [],
    fields: query.fields,
  }));
  const perMemberPerPoint =
    query.variables.length * query.pressureLevelsHpa.length + fieldScalarOutputs;
  const samples = query.points.length * memberCount * perMemberPerPoint;
  if (samples > query.maxMemberSamples) {
    throw new Error(
      `GEFSv12 reforecast mixed multi-point query would return ${samples} member scalar samples, exceeding maxMemberSamples=${query.maxMemberSamples}`,
    );
  }
}

function rangeSourceSummary(
  decoder: "gribberish" | "wgrib2",
  allCacheHit: boolean,
) {
  return {
    provider: "NOAA AWS Open Data" as const,
    access: "s3_range" as const,
    decoder,
    archiveType: "reforecast" as const,
    dataset: "GEFSv12/reforecast" as const,
    gridSemantics: "pressure_and_field_grids_reported_separately" as const,
    nativeCadence: [
      { fromForecastHour: 3 as const, throughForecastHour: 240 as const, stepHours: 3 as const },
      { fromForecastHour: 246 as const, throughForecastHour: 384 as const, stepHours: 6 as const },
    ] as const,
    allCacheHit,
  };
}

function withoutMembers<T extends { members?: unknown }>(block: T): Omit<T, "members"> {
  const { members: _members, ...rest } = block;
  return rest;
}

function sameMixedSelection(
  left: GefsReforecastMixedPointResult["selection"],
  right: GefsReforecastMixedPointResult["selection"],
): boolean {
  return sameArray(left.variables, right.variables)
    && sameArray(left.pressureLevelsHpa, right.pressureLevelsHpa)
    && sameArray(left.fields, right.fields)
    && sameArray(left.members, right.members)
    && sameArray(left.quantiles, right.quantiles);
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
