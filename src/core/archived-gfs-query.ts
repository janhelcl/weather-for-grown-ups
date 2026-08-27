import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import type { HistoricalGfsFieldId } from "../schema/history-fields.js";
import {
  archivedGfsModelId,
  gfsGridSpacingDegrees,
  type ArchivedGfsModelId,
  type GfsGrid,
} from "../schema/gfs-grid.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { archivedGfsForecastHourSchema } from "../schema/history-forecast.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import {
  NCEI_GFS_GRID4_FORECAST_START,
  NceiGfsForecastHistorySource,
  type ArchivedGfsForecastAreaDataSource,
  type ArchivedGfsForecastDataSource,
} from "../sources/ncei-gfs-forecast-history.js";
import {
  RDA_GFS_0P25_FORECAST_START,
  RdaGfsForecastHistorySource,
} from "../sources/rda-gfs-forecast-history.js";
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
export const ARCHIVED_GFS_0P25_FORECAST_MODEL = "gfs_0p25_forecast_archive" as const;
const ARCHIVE_CAVEAT =
  "Archived GFS forecast from the historical 0.5-degree Grid 4 product; model versions changed over time and this is not a homogeneous reforecast dataset" as const;

type Point = { latitude: number; longitude: number };

interface ArchivedPointResult {
  model: ArchivedGfsModelId;
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
    provider: "NOAA NCEI" | "NCAR GDEX";
    access: "ncei_thredds_ncss" | "gdex_thredds_ncss";
    dataset: string;
    cacheHit: boolean;
  };
  caveat: typeof ARCHIVE_CAVEAT;
}

export interface ArchivedGfsForecastQueryServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  rdaSource?: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  profile?: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">;
  now?: () => Date;
}

export class ArchivedGfsForecastQueryService {
  private readonly nceiSource: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  private readonly rdaSource: ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource;
  private readonly profile: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastQueryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    this.nceiSource = options.source ?? new NceiGfsForecastHistorySource({
      cacheDir: join(cacheDir, "ncei-forecast-history"),
      limiter,
    });
    this.rdaSource = options.rdaSource ?? new RdaGfsForecastHistorySource({
      cacheDir: join(cacheDir, "rda-forecast-history"),
      limiter,
    });
    this.now = options.now ?? (() => new Date());
    this.profile = options.profile ?? new ArchivedGfsForecastProfileService({
      source: this.nceiSource,
      rdaSource: this.rdaSource,
      now: this.now,
    });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") throw new Error("Archived GFS forecast routing only accepts dataset=gfs");
    if (request.source !== undefined && request.source !== "archive") {
      throw new Error("source override is only available for operational GFS; archived forecasts accept source=archive only");
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
    const forecastHours = archivedGfsForecastHoursInRange(
      run,
      startTime,
      endTime,
      request.forecast?.grid ?? "0p25",
    );
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
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: point,
      gridPoint: first.gridPoint,
      selection: first.selection,
      source: {
        ...archiveSourceMetadata(request.forecast?.grid ?? "0p25"),
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
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
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
        ...archiveSourceMetadata(request.forecast?.grid ?? "0p25"),
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
    const forecastHours = archivedGfsForecastHoursInRange(
      run,
      startTime,
      endTime,
      request.forecast?.grid ?? "0p25",
    );
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
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      selection,
      source: {
        ...archiveSourceMetadata(request.forecast?.grid ?? "0p25"),
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
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
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
        ...archiveSourceMetadata(request.forecast?.grid ?? "0p25"),
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
    const grid = request.forecast?.grid ?? "0p25";
    const fh = archivedForecastHour(run, validTime, grid);
    const source = this.sourceForGrid(grid);
    const areaSource: HistoricalAnalysisAreaDataSource = {
      fetchArea: async (input) => source.fetchArea({
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
      minimumTime: archiveMinimumTime(grid),
      gridSpacingDegrees: gfsGridSpacingDegrees(grid),
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
    const {
      model: _model,
      analysisTime: _analysisTime,
      caveat: _caveat,
      source: historicalSource,
      ...rest
    } = result;
    return {
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      ...rest,
      source: {
        ...archiveSourceMetadata(grid),
        subset: historicalSource.subset,
        dataset: historicalSource.dataset,
        cacheHit: historicalSource.cacheHit,
      },
      caveat: ARCHIVE_CAVEAT,
    };
  }

  private async getPoint(
    point: Point,
    run: Date,
    validTime: Date,
    request: QueryAtmosphereRequest,
  ): Promise<ArchivedPointResult> {
    const grid = request.forecast?.grid ?? "0p25";
    const fh = archivedForecastHour(run, validTime, grid);
    const source = this.sourceForGrid(grid);
    const variables = request.selection.variables as HistoricalGfsVariableId[] | undefined;
    const pressureLevelsHpa = request.selection.pressureLevelsHpa;
    const fields = request.selection.fields as HistoricalGfsFieldId[] | undefined;

    if (fields !== undefined && fields.length > 0) {
      const adapter: HistoricalAnalysisDataSource = {
        fetch: async (input) => source.fetch({
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
        minimumTime: archiveMinimumTime(grid),
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
        model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
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
        source: {
          ...archiveSourceMetadata(grid),
          dataset: result.source.dataset,
          cacheHit: result.source.cacheHit,
        },
        caveat: ARCHIVE_CAVEAT,
      };
    }

    if (variables === undefined || pressureLevelsHpa === undefined) {
      throw new Error("Archived GFS point forecast requires pressure variables+levels or historical archive fields");
    }
    const result = await this.profile.getArchivedForecastProfile({
      runTime: run,
      grid,
      forecastHour: fh,
      latitude: point.latitude,
      longitude: point.longitude,
      variables,
      pressureLevelsHpa,
    });
    return {
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"),
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

  private sourceForGrid(
    grid: GfsGrid,
  ): ArchivedGfsForecastDataSource & ArchivedGfsForecastAreaDataSource {
    return grid === "0p50" ? this.nceiSource : this.rdaSource;
  }
}

export function shouldUseArchivedGfsForecast(
  request: {
    dataset: string;
    forecast?: { run: string; grid?: GfsGrid } | undefined;
    source?: string | undefined;
  },
  now: Date = new Date(),
): boolean {
  if (request.dataset !== "gfs") return false;
  if (request.source === "nomads" || request.source === "s3") return false;
  const selector = request.forecast?.run;
  if (selector === undefined || selector === "latest" || selector === "latest_complete") return false;
  const run = parseGfsRun(selector);
  if (request.source === "archive") return true;
  return now.getTime() - run.getTime() > GFS_OPERATIONAL_ARCHIVE_WINDOW_DAYS * DAY_MS;
}

export function archivedGfsForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
  grid: GfsGrid = "0p50",
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }
  const nativeHours = grid === "0p50"
    ? Array.from({ length: 65 }, (_, index) => index * 3)
    : [
        ...Array.from({ length: 81 }, (_, index) => index * 3),
        ...Array.from({ length: 12 }, (_, index) => 252 + index * 12),
      ];
  const hours = nativeHours.filter((fh) => {
    const validTime = validTimeForForecastHour(run, fh);
    return validTime >= startTime && validTime <= endTime;
  });
  if (hours.length === 0) {
    throw new Error(
      grid === "0p50"
        ? "No native archived GFS Grid 4 forecast outputs fall inside the requested time range"
        : "No native archived GFS 0.25 forecast outputs fall inside the requested time range",
    );
  }
  return hours;
}

function archivedForecastHour(run: Date, validTime: Date, grid: GfsGrid): number {
  const fh = forecastHour(run, validTime, grid);
  if (grid === "0p50") return archivedGfsForecastHourSchema.parse(fh);
  if (fh <= 240 && fh % 3 === 0) return fh;
  if (fh >= 252 && fh <= 384 && fh % 12 === 0) return fh;
  throw new Error("Archived GFS 0.25 forecast valid time is not on a native archive step");
}

function archiveMinimumTime(grid: GfsGrid): Date {
  return grid === "0p50" ? NCEI_GFS_GRID4_FORECAST_START : RDA_GFS_0P25_FORECAST_START;
}

function archiveSourceMetadata(grid: GfsGrid): {
  provider: "NOAA NCEI" | "NCAR GDEX";
  access: "ncei_thredds_ncss" | "gdex_thredds_ncss";
} {
  return grid === "0p50"
    ? { provider: "NOAA NCEI", access: "ncei_thredds_ncss" }
    : { provider: "NCAR GDEX", access: "gdex_thredds_ncss" };
}

function assertStableGridPoint(series: readonly ArchivedPointResult[], expected: Point): void {
  for (const step of series) {
    if (step.gridPoint.latitude !== expected.latitude || step.gridPoint.longitude !== expected.longitude) {
      throw new Error("Archived GFS grid point changed within one time-series query");
    }
  }
}
