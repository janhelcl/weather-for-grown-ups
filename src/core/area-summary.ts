import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NomadsCache } from "../cache/nomads-cache.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import { Wgrib2StatsDecoder, type AreaBox, type GridStatistics } from "../grib/wgrib2-stats.js";
import { areaSummaryQuerySchema, GFS_GRID_SPACING_DEG, type AreaSummaryQueryInput, type RawVariableId } from "../schema/query.js";
import { buildNomadsAreaUrl } from "../sources/nomads.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import type { AreaSummaryResult } from "./types.js";

export interface AreaFileCache { fetch(url: string): Promise<{ path: string; cacheHit: boolean }>; }
export interface AreaStatsDecoder { summarizeBox(path: string, box: AreaBox): Promise<GridStatistics>; }
export interface AreaSummaryServiceOptions {
  cacheDir?: string; cooldownMs?: number; wgrib2Path?: string;
  cache?: AreaFileCache; decoder?: AreaStatsDecoder; latestRunProvider?: LatestRunProvider;
}

export class AreaSummaryService {
  private readonly cache: AreaFileCache;
  private readonly decoder: AreaStatsDecoder;
  private readonly latestRunProvider: LatestRunProvider;

  constructor(options: AreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(join(cacheDir, "state"), options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS);
    this.cache = options.cache ?? new NomadsCache(join(cacheDir, "grib"), limiter);
    this.decoder = options.decoder ?? new Wgrib2StatsDecoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
  }

  async summarize(input: AreaSummaryQueryInput): Promise<AreaSummaryResult> {
    const query = areaSummaryQuerySchema.parse(input);
    const estimatedGridPoints = estimateGridPoints(query);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new Error(`Requested bbox is approximately ${estimatedGridPoints} GFS grid points, exceeding maxGridPoints=${query.maxGridPoints}`);
    }

    const validTime = new Date(query.validTime);
    const variable = VARIABLE_CATALOG[query.variable] as RawVariableDefinition;
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: [variable.gfsCode],
            pressureLevelsHpa: [query.pressureLevelHpa],
            fields: [],
          },
        })
      : query.run === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun()
        : parseGfsRun(query.run);
    const fh = forecastHour(run, validTime);
    const box: AreaBox = {
      westLongitude: query.westLongitude, eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude, northLatitude: query.northLatitude,
    };
    const url = buildNomadsAreaUrl({
      run, forecastHour: fh, ...box, variables: [variable], pressureLevelsHpa: [query.pressureLevelHpa],
    });
    const cached = await this.cache.fetch(url);
    const rawStats = await this.decoder.summarizeBox(cached.path, box);
    const stats = normalizeStats(query.variable, rawStats);
    const output = variable.outputs[0];

    return {
      model: "gfs_0p25", run: run.toISOString(), validTime: validTime.toISOString(), forecastHour: fh,
      bbox: box,
      variable: { id: query.variable, pressureHpa: query.pressureLevelHpa, field: output.field, unit: output.unit },
      statistics: {
        definedGridPoints: rawStats.definedGridPoints, mean: stats.mean, min: stats.min, max: stats.max,
        meanKind: "unweighted_grid_point_mean",
      },
      source: { provider: "NOAA NOMADS", access: "nomads_grib_filter", decoder: "wgrib2", cacheHit: cached.cacheHit },
    };
  }
}

export function estimateGridPoints(box: AreaBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / GFS_GRID_SPACING_DEG) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / GFS_GRID_SPACING_DEG) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizeStats(variable: RawVariableId, stats: GridStatistics) {
  if (variable !== "temperature") return { mean: stats.mean, min: stats.min, max: stats.max };
  return { mean: stats.mean - 273.15, min: stats.min - 273.15, max: stats.max - 273.15 };
}
