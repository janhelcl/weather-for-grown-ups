import { homedir } from "node:os";
import { join } from "node:path";
import { FileAccessPolicy, UPSTREAM_ACCESS_POLICIES, type UpstreamAccessPolicy } from "../access/access-policy.js";
import { CachedGfsAnalysisFileStore, CachedNceiGfsForecastHistorySource, CachedRdaGfsForecastHistorySource } from "../cache/historical-gfs-cache.js";
import type { HistoricalGfsFieldId } from "../schema/history-fields.js";
import { archivedGfsModelId, gfsGridSpacingDegrees, type ArchivedGfsModelId, type GfsGrid } from "../schema/gfs-grid.js";
import type { HistoricalGfsVariableId } from "../schema/history.js";
import { archivedGfsForecastHourSchema } from "../schema/history-forecast.js";
import { historicalAreaFieldLevel } from "../schema/history-area-summary.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import { ArchivedGfsForecastAnalysisAdapter } from "../sources/archived-gfs-analysis-adapter.js";
import type { ArchivedGfsForecastAccess, ArchivedGfsForecastProvider, ArchivedGfsForecastSource } from "../sources/archived-gfs-forecast.js";
import type { HistoricalAnalysisSource } from "../sources/gfs-analysis.js";
import { RoutedGfs0p50ForecastAnalysisSource } from "../sources/gfs-forecast-routed.js";
import { NCEI_GFS_GRID4_FORECAST_START, NceiGfsForecastHistorySource } from "../sources/ncei-gfs-forecast-history.js";
import { RDA_GFS_0P25_FORECAST_START, RdaGfsForecastHistorySource } from "../sources/rda-gfs-forecast-history.js";
import { forecastHour, parseGfsRun, validTimeForForecastHour } from "./forecast-hour.js";
import { estimateHistoricalGridPoints, loadHistoricalAreaData, resolveHistoricalAreaSourceSelection } from "./history-area-summary.js";
import { loadHistoricalFieldsData } from "./history-fields.js";
import { ArchivedGfsForecastProfileService, type ArchivedGfsForecastProfileResult } from "./history-forecast.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";
import { InvalidRequestError } from "../failure.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
export const GFS_OPERATIONAL_ARCHIVE_WINDOW_DAYS = 28;
export const ARCHIVED_GFS_FORECAST_MODEL = "gfs_grid4_forecast_0p5_archive" as const;
export const ARCHIVED_GFS_0P25_FORECAST_MODEL = "gfs_0p25_forecast_archive" as const;
const ARCHIVE_0P50_CAVEAT = "Archived GFS forecast from the historical 0.5-degree Grid 4 product; model versions changed over time and this is not a homogeneous reforecast dataset" as const;
const ARCHIVE_0P25_CAVEAT = "Archived GFS forecast from the NCAR GDEX 0.25-degree operational GFS archive; model versions changed over time and this is not a homogeneous reforecast dataset" as const;

type Point = { latitude: number; longitude: number };
interface ArchivedPointResult {
  model: ArchivedGfsModelId; run: string; validTime: string; forecastHour: number;
  requestedPoint: Point; gridPoint: Point;
  selection: { variables?: readonly HistoricalGfsVariableId[]; pressureLevelsHpa?: readonly number[]; fields?: readonly HistoricalGfsFieldId[] };
  levels?: ArchivedGfsForecastProfileResult["levels"]; fields?: unknown[];
  source: { provider: ArchivedGfsForecastProvider; access: ArchivedGfsForecastAccess; dataset: string; cacheHit: boolean };
  caveat: typeof ARCHIVE_0P50_CAVEAT | typeof ARCHIVE_0P25_CAVEAT;
}
type ResolvedArchivedRoute = Pick<ArchivedPointResult["source"], "provider" | "access">;

export interface ArchivedGfsForecastQueryServiceOptions {
  cacheDir?: string; nceiAccessPolicy?: UpstreamAccessPolicy; awsAccessPolicy?: UpstreamAccessPolicy; gdexAccessPolicy?: UpstreamAccessPolicy;
  fetchFn?: typeof fetch; source?: ArchivedGfsForecastSource; rdaSource?: ArchivedGfsForecastSource;
  profile?: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">; now?: () => Date;
}

export class ArchivedGfsForecastQueryService {
  private readonly nceiSource: ArchivedGfsForecastSource;
  private readonly rdaSource: ArchivedGfsForecastSource;
  private readonly nceiAccessPolicy: UpstreamAccessPolicy;
  private readonly awsAccessPolicy: UpstreamAccessPolicy;
  private readonly fileStore: CachedGfsAnalysisFileStore;
  private readonly injectedNcei: boolean;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly profile: Pick<ArchivedGfsForecastProfileService, "getArchivedForecastProfile">;
  private readonly now: () => Date;

  constructor(options: ArchivedGfsForecastQueryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.nceiAccessPolicy = options.nceiAccessPolicy ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    this.awsAccessPolicy = options.awsAccessPolicy ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.noaaAws);
    const gdexAccessPolicy = options.gdexAccessPolicy ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.gdex);
    this.injectedNcei = options.source !== undefined;
    this.fetchFn = options.fetchFn;
    this.fileStore = new CachedGfsAnalysisFileStore(join(cacheDir, "gfs-forecast-fileserver"));
    this.nceiSource = options.source ?? new CachedNceiGfsForecastHistorySource(join(cacheDir, "ncei-forecast-history"), new NceiGfsForecastHistorySource({ limiter: this.nceiAccessPolicy, ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }) }));
    this.rdaSource = options.rdaSource ?? new CachedRdaGfsForecastHistorySource(join(cacheDir, "rda-forecast-history"), new RdaGfsForecastHistorySource({ limiter: gdexAccessPolicy, ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }) }));
    this.now = options.now ?? (() => new Date());
    this.profile = options.profile ?? new ArchivedGfsForecastProfileService({ ...(this.injectedNcei ? { source: this.nceiSource } : {}), rdaSource: this.rdaSource, nceiAccessPolicy: this.nceiAccessPolicy, awsAccessPolicy: this.awsAccessPolicy, cacheDir, ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }), now: this.now });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") throw new Error("Archived GFS forecast routing only accepts dataset=gfs");
    if (request.source !== undefined && request.source !== "archive") throw new Error("source override is only available for operational GFS; archived forecasts accept source=archive only");
    const selector = request.forecast?.run;
    if (selector === undefined || selector === "latest" || selector === "latest_complete") throw new Error("Archived GFS forecast routing requires an explicit forecast.run cycle");
    const run = parseGfsRun(selector);
    switch (request.geometry.type) {
      case "point": return "at" in request.time ? this.pointInstant(request, run) : this.pointRange(request, run);
      case "points": return "at" in request.time ? this.pointsInstant(request, run) : this.pointsRange(request, run);
      case "transect": return this.transect(request, run);
      case "area": return this.area(request, run);
    }
  }

  private async pointInstant(request: QueryAtmosphereRequest, run: Date): Promise<ArchivedPointResult> {
    if (request.geometry.type !== "point" || !("at" in request.time)) throw new Error("Internal archive routing error: expected point + instant");
    return this.getPoint({ latitude: request.geometry.latitude, longitude: request.geometry.longitude }, run, new Date(request.time.at), request);
  }

  private async pointRange(request: QueryAtmosphereRequest, run: Date): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) throw new Error("Internal archive routing error: expected point + range");
    const startTime = new Date(request.time.from); const endTime = new Date(request.time.to);
    const forecastHours = archivedGfsForecastHoursInRange(run, startTime, endTime, request.forecast?.grid ?? "0p25");
    const maxSteps = request.time.maxSteps ?? 65;
    if (forecastHours.length > maxSteps) throw new InvalidRequestError(`Requested archived GFS range contains ${forecastHours.length} native 3-hour outputs, exceeding maxSteps=${maxSteps}`);
    const point = { latitude: request.geometry.latitude, longitude: request.geometry.longitude };
    const series: ArchivedPointResult[] = [];
    for (const fh of forecastHours) series.push(await this.getPoint(point, run, validTimeForForecastHour(run, fh), request));
    const first = series[0]!; assertStableGridPoint(series, first.gridPoint);
    return {
      model: archivedGfsModelId(request.forecast?.grid ?? "0p25"), run: run.toISOString(), requestedStartTime: startTime.toISOString(), requestedEndTime: endTime.toISOString(), requestedPoint: point, gridPoint: first.gridPoint, selection: first.selection,
      source: { routes: resolvedArchivedRoutes(series), composition: "serial_native_forecast_steps" },
      series: series.map((step) => ({ validTime: step.validTime, forecastHour: step.forecastHour, ...(step.levels === undefined ? {} : { levels: step.levels }), ...(step.fields === undefined ? {} : { fields: step.fields }), provider: step.source.provider, access: step.source.access, dataset: step.source.dataset, cacheHit: step.source.cacheHit })),
      caveat: archiveCaveat(request.forecast?.grid ?? "0p25"),
    };
  }

  private async pointsInstant(request: QueryAtmosphereRequest, run: Date): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) throw new Error("Internal archive routing error: expected points + instant");
    const validTime = new Date(request.time.at); const points: ArchivedPointResult[] = [];
    for (const point of request.geometry.points) points.push(await this.getPoint(point, run, validTime, request));
    const first = points[0]!;
    return { model: archivedGfsModelId(request.forecast?.grid ?? "0p25"), run: run.toISOString(), validTime: validTime.toISOString(), forecastHour: first.forecastHour, selection: first.selection,
      points: points.map((point) => ({ requestedPoint: point.requestedPoint, gridPoint: point.gridPoint, ...(point.levels === undefined ? {} : { levels: point.levels }), ...(point.fields === undefined ? {} : { fields: point.fields }), provider: point.source.provider, access: point.source.access, dataset: point.source.dataset, cacheHit: point.source.cacheHit })),
      source: { routes: resolvedArchivedRoutes(points), composition: "serial_point_queries" }, caveat: archiveCaveat(request.forecast?.grid ?? "0p25") };
  }

  private async pointsRange(request: QueryAtmosphereRequest, run: Date): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) throw new Error("Internal archive routing error: expected points + range");
    const startTime = new Date(request.time.from); const endTime = new Date(request.time.to);
    const forecastHours = archivedGfsForecastHoursInRange(run, startTime, endTime, request.forecast?.grid ?? "0p25");
    const maxSteps = request.time.maxSteps ?? 65;
    if (forecastHours.length > maxSteps) throw new InvalidRequestError(`Requested archived GFS range contains ${forecastHours.length} native 3-hour outputs, exceeding maxSteps=${maxSteps}`);
    const pointSteps = forecastHours.length * request.geometry.points.length; const maxPointSteps = request.limits?.maxPointSteps ?? 5_000;
    if (pointSteps > maxPointSteps) throw new InvalidRequestError(`Requested archived GFS matrix contains ${request.geometry.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${maxPointSteps}.`);
    const series: Array<{ validTime: string; forecastHour: number; points: unknown[] }> = []; const resolvedPoints: ArchivedPointResult[] = []; let selection: ArchivedPointResult["selection"] | undefined;
    for (const fh of forecastHours) {
      const validTime = validTimeForForecastHour(run, fh); const points: ArchivedPointResult[] = [];
      for (const point of request.geometry.points) points.push(await this.getPoint(point, run, validTime, request));
      resolvedPoints.push(...points); selection ??= points[0]!.selection;
      series.push({ validTime: validTime.toISOString(), forecastHour: fh, points: points.map((point) => ({ requestedPoint: point.requestedPoint, gridPoint: point.gridPoint, ...(point.levels === undefined ? {} : { levels: point.levels }), ...(point.fields === undefined ? {} : { fields: point.fields }), provider: point.source.provider, access: point.source.access, dataset: point.source.dataset, cacheHit: point.source.cacheHit })) });
    }
    return { model: archivedGfsModelId(request.forecast?.grid ?? "0p25"), run: run.toISOString(), requestedStartTime: startTime.toISOString(), requestedEndTime: endTime.toISOString(), selection, source: { routes: resolvedArchivedRoutes(resolvedPoints), composition: "serial_forecast_step_point_queries" }, series, caveat: archiveCaveat(request.forecast?.grid ?? "0p25") };
  }

  private async transect(request: QueryAtmosphereRequest, run: Date): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) throw new Error("Internal archive routing error: expected transect + instant");
    const validTime = new Date(request.time.at); const samples = request.geometry.samples ?? 10;
    const requestedPoints = interpolateGreatCircle(request.geometry.start, request.geometry.end, samples); const totalDistanceKm = greatCircleDistanceKm(request.geometry.start, request.geometry.end); const points: ArchivedPointResult[] = [];
    for (const point of requestedPoints) points.push(await this.getPoint(point, run, validTime, request)); const first = points[0]!;
    return { model: archivedGfsModelId(request.forecast?.grid ?? "0p25"), run: run.toISOString(), validTime: validTime.toISOString(), forecastHour: first.forecastHour, startPoint: { ...request.geometry.start }, endPoint: { ...request.geometry.end }, totalDistanceKm, selection: first.selection,
      samples: points.map((point, index) => { const fraction = index / (points.length - 1); return { index, fraction, distanceKm: totalDistanceKm * fraction, requestedPoint: point.requestedPoint, gridPoint: point.gridPoint, ...(point.levels === undefined ? {} : { levels: point.levels }), ...(point.fields === undefined ? {} : { fields: point.fields }), provider: point.source.provider, access: point.source.access, dataset: point.source.dataset, cacheHit: point.source.cacheHit }; }),
      source: { routes: resolvedArchivedRoutes(points), composition: "great_circle_to_serial_point_queries" }, caveat: archiveCaveat(request.forecast?.grid ?? "0p25") };
  }

  private async area(request: QueryAtmosphereRequest, run: Date): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) throw new Error("Internal archive routing error: expected area + instant");
    const validTime = new Date(request.time.at); const grid = request.forecast?.grid ?? "0p25"; const fh = archivedForecastHour(run, validTime, grid); const source = this.sourceForGrid(grid); const adapter = this.analysisAdapter(grid, source, run, fh, validTime);
    const bbox = { westLongitude: request.geometry.westLongitude, eastLongitude: request.geometry.eastLongitude, southLatitude: request.geometry.southLatitude, northLatitude: request.geometry.northLatitude };
    const maxGridPoints = request.limits?.maxGridPoints ?? 2_500; const estimatedGridPoints = estimateHistoricalGridPoints(bbox, gfsGridSpacingDegrees(grid));
    if (estimatedGridPoints > maxGridPoints) throw new InvalidRequestError(`Requested bbox is approximately ${estimatedGridPoints} historical GFS grid points, exceeding maxGridPoints=${maxGridPoints}`);
    const scalar = (request.selection.fields?.length ?? 0) === 1 ? { field: request.selection.fields![0] as HistoricalGfsFieldId } : { variable: request.selection.variables![0] as HistoricalGfsVariableId, pressureLevelHpa: request.selection.pressureLevelsHpa![0] };
    const selection = resolveHistoricalAreaSourceSelection(scalar);
    const loaded = await loadHistoricalAreaData({ source: adapter, analysisTime: validTime, bbox, definition: selection.definition, ...(selection.verticalCoordinate === undefined ? {} : { verticalCoordinate: selection.verticalCoordinate }), percentiles: request.aggregate?.percentiles, thresholds: request.aggregate?.thresholds, includeExtremaLocations: request.aggregate?.includeExtremaLocations });
    return { model: archivedGfsModelId(grid), run: run.toISOString(), validTime: validTime.toISOString(), forecastHour: fh, bbox,
      ...(request.selection.fields?.length === 1 ? { field: { id: request.selection.fields[0], level: historicalAreaFieldLevel(request.selection.fields[0] as HistoricalGfsFieldId), temporal: { type: "instantaneous" }, output: { field: selection.definition.outputField, unit: selection.definition.unit } } } : { variable: { id: request.selection.variables![0], pressureHpa: request.selection.pressureLevelsHpa![0], field: selection.definition.outputField, unit: selection.definition.unit } }),
      statistics: { ...loaded.computed.statistics, meanKind: "unweighted_grid_point_mean" }, ...(loaded.distributionRequested ? { distribution: loaded.computed.distribution } : {}),
      source: { provider: loaded.response.provider, access: loaded.response.access, subset: "native_bbox_grid", dataset: loaded.response.dataset, cacheHit: loaded.response.cacheHit }, caveat: archiveCaveat(grid) };
  }

  private async getPoint(point: Point, run: Date, validTime: Date, request: QueryAtmosphereRequest): Promise<ArchivedPointResult> {
    const grid = request.forecast?.grid ?? "0p25"; const fh = archivedForecastHour(run, validTime, grid); const source = this.sourceForGrid(grid);
    const variables = request.selection.variables as HistoricalGfsVariableId[] | undefined; const pressureLevelsHpa = request.selection.pressureLevelsHpa; const fields = request.selection.fields as HistoricalGfsFieldId[] | undefined;
    if (fields !== undefined && fields.length > 0) {
      const adapter = this.analysisAdapter(grid, source, run, fh, validTime);
      const loaded = await loadHistoricalFieldsData({ source: adapter, analysisTime: validTime, latitude: point.latitude, longitude: point.longitude, fields });
      const profile = variables !== undefined && pressureLevelsHpa !== undefined ? await this.profile.getArchivedForecastProfile({ runTime: run, grid, forecastHour: fh, latitude: point.latitude, longitude: point.longitude, variables, pressureLevelsHpa }) : undefined;
      const firstResponse = loaded.responses[0]; if (!firstResponse) throw new Error("Archived GFS field query resolved no source fields");
      return { model: archivedGfsModelId(grid), run: run.toISOString(), validTime: validTime.toISOString(), forecastHour: fh, requestedPoint: point, gridPoint: profile?.gridPoint ?? loaded.gridPoint, selection: { ...(variables === undefined ? {} : { variables }), ...(pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa }), fields }, ...(profile === undefined ? {} : { levels: profile.levels }), fields: loaded.fields,
        source: { provider: firstResponse.provider, access: firstResponse.access, dataset: firstResponse.dataset, cacheHit: loaded.responses.every((response) => response.cacheHit) && (profile?.source.cacheHit ?? true) }, caveat: archiveCaveat(grid) };
    }
    if (variables === undefined || pressureLevelsHpa === undefined) throw new Error("Archived GFS point forecast requires pressure variables+levels or historical archive fields");
    const result = await this.profile.getArchivedForecastProfile({ runTime: run, grid, forecastHour: fh, latitude: point.latitude, longitude: point.longitude, variables, pressureLevelsHpa });
    return { model: archivedGfsModelId(grid), run: run.toISOString(), validTime: result.validTime, forecastHour: result.forecastHour, requestedPoint: result.requestedPoint, gridPoint: result.gridPoint, selection: result.selection, levels: result.levels, source: result.source, caveat: archiveCaveat(grid) };
  }

  private analysisAdapter(grid: GfsGrid, source: ArchivedGfsForecastSource, runTime: Date, forecastHourValue: number, validTime: Date): HistoricalAnalysisSource {
    const minimumTime = archiveMinimumTime(grid); if (runTime < minimumTime) throw new Error(`GFS ${grid} forecast history begins at ${minimumTime.toISOString()} for this archive`);
    if (grid === "0p25" || this.injectedNcei) return new ArchivedGfsForecastAnalysisAdapter({ source, areaSource: source, runTime, forecastHour: forecastHourValue, validTime, ...(grid === "0p25" ? { provider: "NCAR GDEX" as const, access: "gdex_thredds_ncss" as const } : { provider: "NOAA NCEI" as const, access: "ncei_thredds_ncss" as const }) });
    return new RoutedGfs0p50ForecastAnalysisSource({ runTime, forecastHour: forecastHourValue, validTime }, { nceiAccessPolicy: this.nceiAccessPolicy, awsAccessPolicy: this.awsAccessPolicy, ncssForecastSource: this.nceiSource, fileStore: this.fileStore, ...(this.fetchFn === undefined ? {} : { fetchFn: this.fetchFn }) });
  }
  private sourceForGrid(grid: GfsGrid): ArchivedGfsForecastSource { return grid === "0p50" ? this.nceiSource : this.rdaSource; }
}

export function shouldUseArchivedGfsForecast(request: { dataset: string; forecast?: { run: string; grid?: GfsGrid | undefined } | undefined; source?: string | undefined }, now: Date = new Date()): boolean {
  if (request.dataset !== "gfs" || request.source === "nomads" || request.source === "s3") return false;
  const selector = request.forecast?.run; if (selector === undefined || selector === "latest" || selector === "latest_complete") return false;
  const run = parseGfsRun(selector); if (request.source === "archive") return true;
  return now.getTime() - run.getTime() > GFS_OPERATIONAL_ARCHIVE_WINDOW_DAYS * DAY_MS;
}
export function archivedGfsForecastHoursInRange(run: Date, startTime: Date, endTime: Date, grid: GfsGrid = "0p50"): number[] {
  if (endTime.getTime() < startTime.getTime()) throw new Error("endTime must be at or after startTime");
  const nativeHours = grid === "0p50" ? Array.from({ length: 65 }, (_, index) => index * 3) : [...Array.from({ length: 81 }, (_, index) => index * 3), ...Array.from({ length: 12 }, (_, index) => 252 + index * 12)];
  const hours = nativeHours.filter((fh) => { const validTime = validTimeForForecastHour(run, fh); return validTime >= startTime && validTime <= endTime; });
  if (hours.length === 0) throw new Error(grid === "0p50" ? "No native archived GFS Grid 4 forecast outputs fall inside the requested time range" : "No native archived GFS 0.25 forecast outputs fall inside the requested time range");
  return hours;
}
function archivedForecastHour(run: Date, validTime: Date, grid: GfsGrid): number { const fh = forecastHour(run, validTime, grid); if (grid === "0p50") return archivedGfsForecastHourSchema.parse(fh); if (fh <= 240 && fh % 3 === 0) return fh; if (fh >= 252 && fh <= 384 && fh % 12 === 0) return fh; throw new Error("Archived GFS 0.25 forecast valid time is not on a native archive step"); }
function archiveMinimumTime(grid: GfsGrid): Date { return grid === "0p50" ? NCEI_GFS_GRID4_FORECAST_START : RDA_GFS_0P25_FORECAST_START; }
function archiveCaveat(grid: GfsGrid): typeof ARCHIVE_0P50_CAVEAT | typeof ARCHIVE_0P25_CAVEAT { return grid === "0p50" ? ARCHIVE_0P50_CAVEAT : ARCHIVE_0P25_CAVEAT; }
function resolvedArchivedRoutes(results: readonly ArchivedPointResult[]): ResolvedArchivedRoute[] { const routes = new Map<string, ResolvedArchivedRoute>(); for (const result of results) { const route = { provider: result.source.provider, access: result.source.access }; routes.set(`${route.provider}\u0000${route.access}`, route); } return [...routes.values()]; }
function assertStableGridPoint(series: readonly ArchivedPointResult[], expected: Point): void { for (const step of series) if (step.gridPoint.latitude !== expected.latitude || step.gridPoint.longitude !== expected.longitude) throw new Error("Archived GFS grid point changed within one time-series query"); }
