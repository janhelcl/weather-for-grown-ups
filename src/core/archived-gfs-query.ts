import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import type { HistoricalGfsFieldId } from "../schema/history-fields.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { archivedGfsForecastHourSchema } from "../schema/history-forecast.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
  type ArchivedGfsForecastAreaDataSource,
  type ArchivedGfsForecastDataSource,
} from "../sources/ncei-gfs-forecast-history.js";
import type {
  HistoricalAnalysisAreaDataSource,
  HistoricalAnalysisDataSource,
} from "../sources/ncei-gfs-history.js";
import { forecastHour, parseGfsRun, validTimeForForecastHour } from "./forecast-hour.js";
import { HistoricalAreaSummaryService } from "./history-area-summary.js";
import { HistoricalFieldsService } from "./history-fields.js";
import {
  ArchivedGfsForecastProfileService,
  type ArchivedGfsForecastProfileResult,
} from "./history-forecast.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const GFS_OPERATIONAL_ARCHIVE_WINDOW_DAYS = 28;
export const ARCHIVED_GFS_FORECAST_MODEL = "gfs_grid4_forecast_0p5_archive" as const;
const ARCHIVE_CAVEAT =
  "Archived GFS forecast from the historical 0.5-degree Grid 4 product; model versions changed over time and this is not a homogeneous reforecast dataset" as const;

type Point = { latitude: number; longitude: number };

interface ArchivedPointResult {
  model: typeof ARCHIVED_GFS_FORECAST_MODEL;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: Point;
  gridPoint: Point;
  selection: {
    variables?: readonly HistoricalGfsVariableId[];
    pressureLevelsHpa?: readonly number[];
    fields?: readonly HistoricalGfsFieldId[];
  };
  levels?: ArchivedGfsForecastProfileResult["levels"];
  fields?: unknown[];
  source: {
    provider: "NOAA NCEI";
    access: "ncei_thredds_ncss";
    dataset: string;
    cacheHit: boolean;
  };
  caveat: typeof ARCHIVE_CAVEAT;
}

export interface ArchivedGfsForecastQueryServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  profile?: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">;
  now?: () => Date;
}

export class ArchivedGfsForecastQueryService {
  private readonly source: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  private readonly profile: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastQueryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    this.source = options.source ?? new NceiGfsForecastHistorySource({
      cacheDir: join(cacheDir, "ncei-forecast-history"),
      limiter,
    });
    this.now = options.now ?? (() => new Date());
    this.profile = options.profile ?? new ArchivedGfsForecastProfileService({
      source: this.source,
      now: this.now,
    });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") throw new Error("Archived GFS forecast routing only accepts dataset=gfs");
    if (request.source !== undefined) {
      throw new Error("source override is only available for operational GFS; archived forecasts use NOAA NCEI");
    }
    const selector = request.forecast?.run;
    if (selector === undefined || selector === "latest" || selector === "latest_complete") {
      throw new Error("Archived GFS forecast routing requires an explicit forecast.run cycle");
    }
    const run = parseGfsRun(selector);

    switch (request.geometry.type) {
      case "point":
        return "at" in request.time
          ? this.pointInstant(request, run)
          : this.pointRange(request, run);
      case "points":
        return "at" in request.time
          ? this.pointsInstant(request, run)
          : this.pointsRange(request, run);
      case "transect":
        return this.transect(request, run);
      case "area":
        return this.area(request, run);
    }
  }

  private async pointInstant(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<ArchivedPointResult> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal archive routing error: expected point + instant");
    }
    return this.getPoint(
      { latitude: request.geometry.latitude, longitude: request.geometry.longitude },
      run,
      new Date(request.time.at),
      request,
    );
  }

  private async pointRange(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal archive routing error: expected point + range");
    }
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const forecastHours = archivedGfsForecastHoursInRange(run, startTime, endTime);
    const maxSteps = request.time.maxSteps ?? 65;
    if (forecastHours.length > maxSteps) {
      throw new Error(
        `Requested archived GFS range contains ${forecastHours.length} native 3-hour outputs, exceeding maxSteps=${maxSteps}`,
      );
    }

    const point = { latitude: request.geometry.latitude, longitude: request.geometry.longitude };
    const series: ArchivedPointResult[] = [];
    for (const fh of forecastHours) {
      series.push(await this.getPoint(point, run, validTimeForForecastHour(run, fh), request));
    }
    const first = series[0]!;
    assertStableGridPoint(series, first.gridPoint);

    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: point,
      gridPoint: first.gridPoint,
      selection: first.selection,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "serial_native_forecast_steps",
      },
      series: series.map((step) => ({
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        ...(step.levels === undefined ? {} : { levels: step.levels }),
        ...(step.fields === undefined ? {} : { fields: step.fields }),
        dataset: step.source.dataset,
        cacheHit: step.source.cacheHit,
      })),
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async pointsInstant(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal archive routing error: expected points + instant");
    }
    const validTime = new Date(request.time.at);
    const points: ArchivedPointResult[] = [];
    for (const point of request.geometry.points) {
      points.push(await this.getPoint(point, run, validTime, request));
    }
    const first = points[0]!;
    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: first.forecastHour,
      selection: first.selection,
      points: points.map((point) => ({
        requestedPoint: point.requestedPoint,
        gridPoint: point.gridPoint,
        ...(point.levels === undefined ? {} : { levels: point.levels }),
        ...(point.fields === undefined ? {} : { fields: point.fields }),
        dataset: point.source.dataset,
        cacheHit: point.source.cacheHit,
      })),
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "serial_point_queries",
      },
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async pointsRange(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal archive routing error: expected points + range");
    }
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const forecastHours = archivedGfsForecastHoursInRange(run, startTime, endTime);
    const maxSteps = request.time.maxSteps ?? 65;
    if (forecastHours.length > maxSteps) {
      throw new Error(
        `Requested archived GFS range contains ${forecastHours.length} native 3-hour outputs, exceeding maxSteps=${maxSteps}`,
      );
    }
    const pointSteps = forecastHours.length * request.geometry.points.length;
    const maxPointSteps = request.limits?.maxPointSteps ?? 5_000;
    if (pointSteps > maxPointSteps) {
      throw new Error(
        `Requested archived GFS matrix contains ${request.geometry.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${maxPointSteps}`,
      );
    }

    const series: Array<{ validTime: string; forecastHour: number; points: unknown[] }> = [];
    let selection: ArchivedPointResult["selection"] | undefined;
    for (const fh of forecastHours) {
      const validTime = validTimeForForecastHour(run, fh);
      const points: ArchivedPointResult[] = [];
      for (const point of request.geometry.points) {
        points.push(await this.getPoint(point, run, validTime, request));
      }
      selection ??= points[0]!.selection;
      series.push({
        validTime: validTime.toISOString(),
        forecastHour: fh,
        points: points.map((point) => ({
          requestedPoint: point.requestedPoint,
          gridPoint: point.gridPoint,
          ...(point.levels === undefined ? {} : { levels: point.levels }),
          ...(point.fields === undefined ? {} : { fields: point.fields }),
          dataset: point.source.dataset,
          cacheHit: point.source.cacheHit,
        })),
      });
    }

    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      selection,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "serial_forecast_step_point_queries",
      },
      series,
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async transect(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal archive routing error: expected transect + instant");
    }
    const validTime = new Date(request.time.at);
    const samples = request.geometry.samples ?? 10;
    const requestedPoints = interpolateGreatCircle(request.geometry.start, request.geometry.end, samples);
    const totalDistanceKm = greatCircleDistanceKm(request.geometry.start, request.geometry.end);
    const points: ArchivedPointResult[] = [];
    for (const point of requestedPoints) {
      points.push(await this.getPoint(point, run, validTime, request));
    }
    const first = points[0]!;

    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: first.forecastHour,
      startPoint: { ...request.geometry.start },
      endPoint: { ...request.geometry.end },
      totalDistanceKm,
      selection: first.selection,
      samples: points.map((point, index) => {
        const fraction = index / (points.length - 1);
        return {
          index,
          fraction,
          distanceKm: totalDistanceKm * fraction,
          requestedPoint: point.requestedPoint,
          gridPoint: point.gridPoint,
          ...(point.levels === undefined ? {} : { levels: point.levels }),
          ...(point.fields === undefined ? {} : { fields: point.fields }),
          dataset: point.source.dataset,
          cacheHit: point.source.cacheHit,
        };
      }),
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "great_circle_to_serial_point_queries",
      },
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async area(
    request: QueryAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal archive routing error: expected area + instant");
    }
    const validTime = new Date(request.time.at);
    const fh = archivedForecastHour(run, validTime);
    const areaSource: HistoricalAnalysisAreaDataSource = {
      fetchArea: async (input) => this.source.fetchArea({
        runTime: run,
        forecastHour: fh,
        westLongitude: input.westLongitude,
        eastLongitude: input.eastLongitude,
        southLatitude: input.southLatitude,
        northLatitude: input.northLatitude,
        variables: input.variables,
        ...(input.verticalCoordinate === undefined ? {} : { verticalCoordinate: input.verticalCoordinate }),
        ...(input.horizontalStride === undefined ? {} : { horizontalStride: input.horizontalStride }),
      }),
    };
    const service = new HistoricalAreaSummaryService({
      source: areaSource,
      now: this.now,
      allowNonAnalysisCycle: true,
      minimumTime: NCEI_GFS_GRID4_FORECAST_START,
    });
    const scalar = (request.selection.fields?.length ?? 0) === 1
      ? { field: request.selection.fields![0] }
      : {
          variable: request.selection.variables![0],
          pressureLevelHpa: request.selection.pressureLevelsHpa![0],
        };
    const result = await service.summarize({
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
      analysisTime: validTime.toISOString(),
      ...scalar,
      ...(request.aggregate ?? {}),
      ...(request.limits?.maxGridPoints === undefined ? {} : { maxGridPoints: request.limits.maxGridPoints }),
    } as any);
    const { model: _model, analysisTime: _analysisTime, caveat: _caveat, ...rest } = result;
    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      ...rest,
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async getPoint(
    point: Point,
    run: Date,
    validTime: Date,
    request: QueryAtmosphereRequest,
  ): Promise<ArchivedPointResult> {
    const fh = archivedForecastHour(run, validTime);
    const variables = request.selection.variables as HistoricalGfsVariableId[] | undefined;
    const pressureLevelsHpa = request.selection.pressureLevelsHpa;
    const fields = request.selection.fields as HistoricalGfsFieldId[] | undefined;

    if (fields !== undefined && fields.length > 0) {
      const adapter: HistoricalAnalysisDataSource = {
        fetch: async (input) => this.source.fetch({
          runTime: run,
          forecastHour: fh,
          latitude: input.latitude,
          longitude: input.longitude,
          variables: input.variables,
        }),
      };
      const service = new HistoricalFieldsService({
        source: adapter,
        now: this.now,
        allowNonAnalysisCycle: true,
        minimumTime: NCEI_GFS_GRID4_FORECAST_START,
      });
      const result = await service.getHistoricalFields({
        latitude: point.latitude,
        longitude: point.longitude,
        analysisTime: validTime.toISOString(),
        ...(variables === undefined ? {} : { variables }),
        ...(pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa }),
        fields,
      });
      return {
        model: ARCHIVED_GFS_FORECAST_MODEL,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour: fh,
        requestedPoint: result.requestedPoint,
        gridPoint: result.gridPoint,
        selection: {
          ...(result.selection.variables === undefined ? {} : { variables: result.selection.variables }),
          ...(result.selection.pressureLevelsHpa === undefined
            ? {}
            : { pressureLevelsHpa: result.selection.pressureLevelsHpa }),
          fields: result.selection.fields,
        },
        ...(result.levels === undefined ? {} : { levels: result.levels }),
        fields: result.fields,
        source: result.source,
        caveat: ARCHIVE_CAVEAT,
      };
    }

    if (variables === undefined || pressureLevelsHpa === undefined) {
      throw new Error("Archived GFS point forecast requires pressure variables+levels or historical archive fields");
    }
    const result = await this.profile.getArchivedForecastProfile({
      runTime: run,
      forecastHour: fh,
      latitude: point.latitude,
      longitude: point.longitude,
      variables,
      pressureLevelsHpa,
    });
    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      validTime: result.validTime,
      forecastHour: result.forecastHour,
      requestedPoint: result.requestedPoint,
      gridPoint: result.gridPoint,
      selection: result.selection,
      levels: result.levels,
      source: result.source,
      caveat: ARCHIVE_CAVEAT,
    };
  }
}

export function shouldUseArchivedGfsForecast(
  request: { dataset: string; forecast?: { run: string } | undefined },
  now: Date = new Date(),
): boolean {
  if (request.dataset !== "gfs") return false;
  const selector = request.forecast?.run;
  if (selector === undefined || selector === "latest" || selector === "latest_complete") return false;
  const run = parseGfsRun(selector);
  return now.getTime() - run.getTime() > GFS_OPERATIONAL_ARCHIVE_WINDOW_DAYS * DAY_MS;
}

export function archivedGfsForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }
  const hours: number[] = [];
  for (let fh = 0; fh <= 192; fh += 3) {
    const validTime = validTimeForForecastHour(run, fh);
    if (validTime >= startTime && validTime <= endTime) hours.push(fh);
  }
  if (hours.length === 0) {
    throw new Error("No native archived GFS Grid 4 forecast outputs fall inside the requested time range");
  }
  return hours;
}

function archivedForecastHour(run: Date, validTime: Date): number {
  return archivedGfsForecastHourSchema.parse(forecastHour(run, validTime));
}

function assertStableGridPoint(series: readonly ArchivedPointResult[], expected: Point): void {
  for (const step of series) {
    if (step.gridPoint.latitude !== expected.latitude || step.gridPoint.longitude !== expected.longitude) {
      throw new Error("Archived GFS grid point changed within one time-series query");
    }
  }
}
