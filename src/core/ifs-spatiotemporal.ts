import { mapConcurrent } from "./concurrency.js";
import { IfsLatestRunResolver, type IfsLatestRangeRunProvider, type IfsLatestRunProvider } from "./ifs-latest-run.js";
import { ifsIndexSelectorsForSelection, IfsProfileService } from "./ifs-profile.js";
import {
  ifsForecastHoursInRange,
  ifsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";
import {
  ifsPointsQuerySchema,
  ifsPointsResultSchema,
  ifsPointsTimeSeriesQuerySchema,
  ifsPointsTimeSeriesResultSchema,
  ifsTimeSeriesQuerySchema,
  ifsTimeSeriesResultSchema,
  ifsTransectQuerySchema,
  ifsTransectResultSchema,
  type IfsPointsQueryInput,
  type IfsPointsResult,
  type IfsPointsTimeSeriesQueryInput,
  type IfsPointsTimeSeriesResult,
  type IfsTimeSeriesQueryInput,
  type IfsTimeSeriesResult,
  type IfsTransectQueryInput,
  type IfsTransectResult,
} from "../schema/ifs-spatiotemporal.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import type { PointCoordinate } from "../schema/query.js";
import { InvalidRequestError } from "../failure.js";

export const DEFAULT_IFS_POINT_CONCURRENCY = 4;
export const DEFAULT_IFS_TIME_CONCURRENCY = 3;

export interface IfsProfileGetter {
  getProfile(input: IfsPointQueryInput): Promise<IfsProfileResult>;
}

export interface IfsSpatiotemporalOptions {
  profileGetter?: IfsProfileGetter;
  latestRunProvider?: IfsLatestRunProvider;
  latestRangeRunProvider?: IfsLatestRangeRunProvider;
  pointConcurrency?: number;
  timeConcurrency?: number;
}

export class IfsTimeSeriesService {
  private readonly profileGetter: IfsProfileGetter;
  private readonly latestRangeRunProvider: IfsLatestRangeRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsSpatiotemporalOptions = {}) {
    const resolver = new IfsLatestRunResolver();
    this.profileGetter = options.profileGetter ?? new IfsProfileService();
    this.latestRangeRunProvider = options.latestRangeRunProvider ?? resolver;
    this.concurrency = options.timeConcurrency ?? DEFAULT_IFS_TIME_CONCURRENCY;
  }

  async getTimeSeries(input: IfsTimeSeriesQueryInput): Promise<IfsTimeSeriesResult> {
    const query = ifsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const selectors = ifsIndexSelectorsForSelection(query);
    const run = query.run === "latest"
      ? await this.latestRangeRunProvider.resolveLatestRunForRange(startTime, endTime, selectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested time range contains ${forecastHours.length} native IFS outputs, exceeding maxSteps=${query.maxSteps}`,
      );
    }

    const profiles = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHour) => this.profileGetter.getProfile(profileInput(
        query,
        { latitude: query.latitude, longitude: query.longitude },
        run,
        ifsValidTimeForForecastHour(run, forecastHour),
      )),
    );
    const first = profiles[0];
    if (!first) throw new Error("No IFS profiles returned for time series");
    assertStableSource(profiles);

    return ifsTimeSeriesResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      source: sourceWithoutCache(first),
      series: profiles.map((profile) => ({
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        gridPoint: profile.gridPoint,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
        cacheHit: profile.source.cacheHit,
      })),
    });
  }
}

export class IfsPointsService {
  private readonly profileGetter: IfsProfileGetter;
  private readonly latestRunProvider: IfsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsSpatiotemporalOptions = {}) {
    const resolver = new IfsLatestRunResolver();
    this.profileGetter = options.profileGetter ?? new IfsProfileService();
    this.latestRunProvider = options.latestRunProvider ?? resolver;
    this.concurrency = options.pointConcurrency ?? DEFAULT_IFS_POINT_CONCURRENCY;
  }

  async getPoints(input: IfsPointsQueryInput): Promise<IfsPointsResult> {
    const query = ifsPointsQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const selectors = ifsIndexSelectorsForSelection(query);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, selectors)
      : parseIfsRun(query.run);

    const profiles = await mapConcurrent(
      query.points,
      this.concurrency,
      async (point) => this.profileGetter.getProfile(profileInput(query, point, run, validTime)),
    );
    const first = profiles[0];
    if (!first) throw new Error("No IFS point profiles returned");
    assertStableSource(profiles);

    return ifsPointsResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: first.forecastHour,
      points: profiles.map(pointSample),
      source: {
        ...sourceWithoutCache(first),
        allCacheHit: profiles.every((profile) => profile.source.cacheHit),
      },
    });
  }
}

export class IfsPointsTimeSeriesService {
  private readonly pointsService: IfsPointsService;
  private readonly latestRangeRunProvider: IfsLatestRangeRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsSpatiotemporalOptions = {}) {
    const resolver = new IfsLatestRunResolver();
    this.pointsService = new IfsPointsService(options);
    this.latestRangeRunProvider = options.latestRangeRunProvider ?? resolver;
    this.concurrency = options.timeConcurrency ?? DEFAULT_IFS_TIME_CONCURRENCY;
  }

  async getPointsTimeSeries(input: IfsPointsTimeSeriesQueryInput): Promise<IfsPointsTimeSeriesResult> {
    const query = ifsPointsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const selectors = ifsIndexSelectorsForSelection(query);
    const run = query.run === "latest"
      ? await this.latestRangeRunProvider.resolveLatestRunForRange(startTime, endTime, selectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested time range contains ${forecastHours.length} native IFS outputs, exceeding maxSteps=${query.maxSteps}`,
      );
    }
    const pointSteps = forecastHours.length * query.points.length;
    if (pointSteps > query.maxPointSteps) {
      throw new InvalidRequestError(
        `Requested IFS points time series contains ${pointSteps} point × time samples, exceeding maxPointSteps=${query.maxPointSteps}`,
      );
    }

    const batches = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHour) => this.pointsService.getPoints({
        points: query.points,
        run: run.toISOString(),
        validTime: ifsValidTimeForForecastHour(run, forecastHour).toISOString(),
        ...(query.variables === undefined ? {} : { variables: query.variables }),
        ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
        ...(query.fields === undefined ? {} : { fields: query.fields }),
      }),
    );
    const first = batches[0];
    if (!first) throw new Error("No IFS point batches returned for time series");
    assertStableBatchSource(batches);

    return ifsPointsTimeSeriesResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      source: sourceWithoutBatchCache(first),
      series: batches.map((batch) => ({
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points,
        allCacheHit: batch.source.allCacheHit,
      })),
    });
  }
}

export class IfsTransectService {
  private readonly pointsService: IfsPointsService;

  constructor(options: IfsSpatiotemporalOptions = {}) {
    this.pointsService = new IfsPointsService(options);
  }

  async getTransect(input: IfsTransectQueryInput): Promise<IfsTransectResult> {
    const query = ifsTransectQuerySchema.parse(input);
    const points = interpolateGreatCircle(query.start, query.end, query.samples);
    const totalDistanceKm = greatCircleDistanceKm(query.start, query.end);
    const batch = await this.pointsService.getPoints({
      points,
      run: query.run,
      validTime: query.validTime,
      ...(query.variables === undefined ? {} : { variables: query.variables }),
      ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
      ...(query.fields === undefined ? {} : { fields: query.fields }),
    });

    return ifsTransectResultSchema.parse({
      model: "ifs_0p25",
      run: batch.run,
      validTime: batch.validTime,
      forecastHour: batch.forecastHour,
      startPoint: { ...query.start },
      endPoint: { ...query.end },
      totalDistanceKm,
      samples: batch.points.map((point, index) => {
        const fraction = index / (batch.points.length - 1);
        return {
          index,
          fraction,
          distanceKm: totalDistanceKm * fraction,
          ...point,
        };
      }),
      source: batch.source,
    });
  }
}

function profileInput(
  query: {
    variables?: readonly any[] | undefined;
    pressureLevelsHpa?: readonly number[] | undefined;
    fields?: readonly any[] | undefined;
  },
  point: PointCoordinate,
  run: Date,
  validTime: Date,
): IfsPointQueryInput {
  return {
    ...point,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    ...(query.variables === undefined ? {} : { variables: [...query.variables] }),
    ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: [...query.pressureLevelsHpa] }),
    ...(query.fields === undefined ? {} : { fields: [...query.fields] }),
  } as IfsPointQueryInput;
}

function pointSample(profile: IfsProfileResult) {
  return {
    requestedPoint: profile.requestedPoint,
    gridPoint: profile.gridPoint,
    levels: profile.levels,
    ...(profile.fields === undefined ? {} : { fields: profile.fields }),
  };
}

function sourceWithoutCache(profile: IfsProfileResult) {
  const { cacheHit: _cacheHit, ...source } = profile.source;
  return source;
}

function sourceWithoutBatchCache(batch: IfsPointsResult) {
  const { allCacheHit: _allCacheHit, ...source } = batch.source;
  return source;
}

function assertStableSource(profiles: readonly IfsProfileResult[]): void {
  const first = profiles[0];
  if (!first) return;
  for (const profile of profiles.slice(1)) {
    if (
      profile.run !== first.run
      || profile.source.provider !== first.source.provider
      || profile.source.access !== first.source.access
      || profile.source.decoder !== first.source.decoder
      || profile.source.product !== first.source.product
      || profile.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
    ) {
      throw new Error("IFS source provenance changed within one composed query");
    }
  }
}

function assertStableBatchSource(batches: readonly IfsPointsResult[]): void {
  const first = batches[0];
  if (!first) return;
  for (const batch of batches.slice(1)) {
    if (
      batch.run !== first.run
      || batch.source.provider !== first.source.provider
      || batch.source.access !== first.source.access
      || batch.source.decoder !== first.source.decoder
      || batch.source.product !== first.source.product
      || batch.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
    ) {
      throw new Error("IFS source provenance changed within one points time-series query");
    }
  }
}
