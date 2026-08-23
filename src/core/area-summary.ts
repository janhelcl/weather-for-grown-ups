import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NomadsCache } from "../cache/nomads-cache.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricLevel,
  type RawNonIsobaricFieldDefinition,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  Wgrib2StatsDecoder,
  type AreaBox,
  type AreaMessageSelector,
  type GridStatistics,
  type SelectedGridStatistics,
  type SelectedMessageTemporal,
} from "../grib/wgrib2-stats.js";
import {
  areaSummaryQuerySchema,
  GFS_GRID_SPACING_DEG,
  type AreaSummaryQueryInput,
  type RawVariableId,
} from "../schema/query.js";
import { buildNomadsAreaUrl } from "../sources/nomads.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import type {
  AreaSummaryResult,
  FieldTemporalResult,
  NonIsobaricFieldLevelResult,
} from "./types.js";

const HOUR_MS = 3_600_000;

export interface AreaFileCache { fetch(url: string): Promise<{ path: string; cacheHit: boolean }>; }
export interface AreaStatsDecoder {
  summarizeBox(path: string, box: AreaBox): Promise<GridStatistics>;
  summarizeSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridStatistics>;
}
export interface AreaSummaryServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  wgrib2Path?: string;
  cache?: AreaFileCache;
  decoder?: AreaStatsDecoder;
  latestRunProvider?: LatestRunProvider;
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
    const box: AreaBox = {
      westLongitude: query.westLongitude,
      eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude,
      northLatitude: query.northLatitude,
    };
    const estimatedGridPoints = estimateGridPoints(box);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new Error(`Requested bbox is approximately ${estimatedGridPoints} GFS grid points, exceeding maxGridPoints=${query.maxGridPoints}`);
    }

    return query.field === undefined
      ? this.summarizePressureVariable(query, box)
      : this.summarizeNonIsobaricField(query, box);
  }

  private async summarizePressureVariable(
    query: ReturnType<typeof areaSummaryQuerySchema.parse>,
    box: AreaBox,
  ): Promise<AreaSummaryResult> {
    const variableId = query.variable;
    const pressureLevelHpa = query.pressureLevelHpa;
    if (variableId === undefined || pressureLevelHpa === undefined) {
      throw new Error("Internal area-summary validation error: pressure-level selection is incomplete");
    }

    const validTime = new Date(query.validTime);
    const variable = VARIABLE_CATALOG[variableId] as RawVariableDefinition;
    const run = await this.resolveRun(
      query.run,
      validTime,
      [variable],
      [pressureLevelHpa],
      [],
    );
    const fh = forecastHour(run, validTime);
    const url = buildNomadsAreaUrl({
      run,
      forecastHour: fh,
      ...box,
      variables: [variable],
      pressureLevelsHpa: [pressureLevelHpa],
    });
    const cached = await this.cache.fetch(url);
    const rawStats = await this.decoder.summarizeBox(cached.path, box);
    const stats = normalizePressureStats(variableId, rawStats);
    const output = variable.outputs[0];

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      bbox: box,
      variable: {
        id: variableId,
        pressureHpa: pressureLevelHpa,
        field: output.field,
        unit: output.unit,
      },
      statistics: publicStatistics(rawStats.definedGridPoints, stats),
      source: areaSource(cached.cacheHit),
    };
  }

  private async summarizeNonIsobaricField(
    query: ReturnType<typeof areaSummaryQuerySchema.parse>,
    box: AreaBox,
  ): Promise<AreaSummaryResult> {
    const fieldId = query.field;
    if (fieldId === undefined) {
      throw new Error("Internal area-summary validation error: field selection is missing");
    }
    const definition = NON_ISOBARIC_FIELD_CATALOG[fieldId];
    if (definition.kind !== "raw") {
      throw new Error(`Internal area-summary validation error: ${fieldId} is derived`);
    }

    const validTime = new Date(query.validTime);
    const run = await this.resolveRun(query.run, validTime, [], [], [definition]);
    const fh = forecastHour(run, validTime);
    const url = buildNomadsAreaUrl({
      run,
      forecastHour: fh,
      ...box,
      variables: [],
      pressureLevelsHpa: [],
      fields: [definition],
    });
    const cached = await this.cache.fetch(url);
    const rawStats = await this.decoder.summarizeSelectedMessage(cached.path, box, {
      code: definition.gfsCode,
      gribLevel: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
    });
    const stats = normalizeFieldStats(definition, rawStats);
    const output = definition.outputs[0];

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      bbox: box,
      field: {
        id: definition.id,
        level: publicLevel(definition.level),
        temporal: publicTemporal(rawStats.temporal, run),
        output: { field: output.field, unit: output.unit },
      },
      statistics: publicStatistics(rawStats.definedGridPoints, stats),
      source: areaSource(cached.cacheHit),
    };
  }

  private async resolveRun(
    selector: ReturnType<typeof areaSummaryQuerySchema.parse>["run"],
    validTime: Date,
    variables: RawVariableDefinition[],
    pressureLevelsHpa: number[],
    fields: RawNonIsobaricFieldDefinition[],
  ): Promise<Date> {
    return selector === "latest"
      ? this.latestRunProvider.resolveLatestRun({
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        })
      : selector === "latest_complete"
        ? this.latestRunProvider.resolveLatestRun()
        : parseGfsRun(selector);
  }
}

export function estimateGridPoints(box: AreaBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / GFS_GRID_SPACING_DEG) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / GFS_GRID_SPACING_DEG) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizePressureStats(variable: RawVariableId, stats: GridStatistics) {
  if (variable !== "temperature") return numericStats(stats);
  return {
    mean: stats.mean - 273.15,
    min: stats.min - 273.15,
    max: stats.max - 273.15,
  };
}

function normalizeFieldStats(
  definition: RawNonIsobaricFieldDefinition,
  stats: GridStatistics,
): { mean: number; min: number; max: number } {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") {
    return {
      mean: stats.mean - 273.15,
      min: stats.min - 273.15,
      max: stats.max - 273.15,
    };
  }
  return numericStats(stats);
}

function numericStats(stats: GridStatistics) {
  return { mean: stats.mean, min: stats.min, max: stats.max };
}

function publicStatistics(
  definedGridPoints: number,
  stats: { mean: number; min: number; max: number },
): AreaSummaryResult["statistics"] {
  return {
    definedGridPoints,
    mean: stats.mean,
    min: stats.min,
    max: stats.max,
    meanKind: "unweighted_grid_point_mean",
  };
}

function publicLevel(level: NonIsobaricLevel): NonIsobaricFieldLevelResult {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m": return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function publicTemporal(temporal: SelectedMessageTemporal, run: Date): FieldTemporalResult {
  if (temporal.type === "instantaneous") return { type: "instantaneous" };
  return {
    type: temporal.type,
    startForecastHour: temporal.startForecastHour,
    endForecastHour: temporal.endForecastHour,
    startTime: new Date(run.getTime() + temporal.startForecastHour * HOUR_MS).toISOString(),
    endTime: new Date(run.getTime() + temporal.endForecastHour * HOUR_MS).toISOString(),
  };
}

function areaSource(cacheHit: boolean): AreaSummaryResult["source"] {
  return {
    provider: "NOAA NOMADS",
    access: "nomads_grib_filter",
    decoder: "wgrib2",
    cacheHit,
  };
}
