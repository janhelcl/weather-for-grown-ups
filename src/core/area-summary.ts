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
  Wgrib2GridDecoder,
  type GridValuePoint,
  type SelectedGridValues,
} from "../grib/wgrib2-grid.js";
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
  type AreaSummaryQueryInput,
} from "../schema/area-summary.js";
import type { AreaSummaryResult } from "../schema/area-summary-result.js";
import {
  gfsGridSpacingDegrees,
  type RawVariableId,
} from "../schema/query.js";
import { buildNomadsAreaUrl } from "../sources/nomads.js";
import { computeAreaDistribution } from "./area-distribution.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import {
  LatestRunResolver,
  resolveLatestCompleteRunForGrid,
  resolveLatestRunForGrid,
  type LatestRunProvider,
} from "./latest-run.js";
import type {
  FieldTemporalResult,
  GribDecoderName,
  NonIsobaricFieldLevelResult,
} from "./types.js";

const HOUR_MS = 3_600_000;

export interface AreaFileCache { fetch(url: string): Promise<{ path: string; cacheHit: boolean }>; }
export interface AreaStatsDecoder {
  readonly engine?: GribDecoderName;
  summarizeBox(path: string, box: AreaBox): Promise<GridStatistics>;
  summarizeSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridStatistics>;
}
export interface AreaGridDecoder {
  readonly engine?: GribDecoderName;
  extractBox(path: string, box: AreaBox): Promise<GridValuePoint[]>;
  extractSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridValues>;
}
export interface AreaSummaryServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  wgrib2Path?: string;
  cache?: AreaFileCache;
  decoder?: AreaStatsDecoder;
  gridDecoder?: AreaGridDecoder;
  latestRunProvider?: LatestRunProvider;
}

export class AreaSummaryService {
  private readonly cache: AreaFileCache;
  private readonly decoder: AreaStatsDecoder;
  private readonly gridDecoder: AreaGridDecoder;
  private readonly latestRunProvider: LatestRunProvider;

  constructor(options: AreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(join(cacheDir, "state"), options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS);
    this.cache = options.cache ?? new NomadsCache(join(cacheDir, "grib"), limiter);
    this.decoder = options.decoder ?? new Wgrib2StatsDecoder(options.wgrib2Path);
    this.gridDecoder = options.gridDecoder ?? new Wgrib2GridDecoder(options.wgrib2Path);
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
    const estimatedGridPoints = estimateGridPoints(box, query.grid ?? "0p25");
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
    const run = await this.resolveRun(query.run, validTime, [variable], [pressureLevelHpa], [], query.grid);
    const fh = forecastHour(run, validTime, query.grid ?? "0p25");
    const url = buildNomadsAreaUrl({
      run,
      ...(query.grid === undefined ? {} : { grid: query.grid }),
      forecastHour: fh,
      ...box,
      variables: [variable],
      pressureLevelsHpa: [pressureLevelHpa],
    });
    const cached = await this.cache.fetch(url);
    const output = variable.outputs[0];
    const distributionRequested = wantsDistribution(query);

    let statistics: AreaSummaryResult["statistics"];
    let distribution: AreaSummaryResult["distribution"] | undefined;
    if (distributionRequested) {
      const rawPoints = await this.gridDecoder.extractBox(cached.path, box);
      const points = normalizeGridPoints(rawPoints, (value) => normalizePressureValue(variableId, value));
      const computed = computeAreaDistribution(points, query);
      statistics = publicStatistics(computed.statistics.definedGridPoints, computed.statistics);
      distribution = computed.distribution;
    } else {
      const rawStats = await this.decoder.summarizeBox(cached.path, box);
      statistics = publicStatistics(rawStats.definedGridPoints, normalizePressureStats(variableId, rawStats));
    }

    return {
      model: query.grid === "0p50" ? "gfs_0p50" : "gfs_0p25",
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
      statistics,
      ...(distribution === undefined ? {} : { distribution }),
      source: areaSource(
        cached.cacheHit,
        distributionRequested ? this.gridDecoder.engine ?? "wgrib2" : this.decoder.engine ?? "wgrib2",
      ),
    };
  }

  private async summarizeNonIsobaricField(
    query: ReturnType<typeof areaSummaryQuerySchema.parse>,
    box: AreaBox,
  ): Promise<AreaSummaryResult> {
    const fieldId = query.field;
    if (fieldId === undefined) throw new Error("Internal area-summary validation error: field selection is missing");
    const definition = NON_ISOBARIC_FIELD_CATALOG[fieldId];
    if (definition.kind !== "raw") throw new Error(`Internal area-summary validation error: ${fieldId} is derived`);

    const validTime = new Date(query.validTime);
    const run = await this.resolveRun(query.run, validTime, [], [], [definition], query.grid);
    const fh = forecastHour(run, validTime, query.grid ?? "0p25");
    const url = buildNomadsAreaUrl({
      run,
      ...(query.grid === undefined ? {} : { grid: query.grid }),
      forecastHour: fh,
      ...box,
      variables: [],
      pressureLevelsHpa: [],
      fields: [definition],
    });
    const cached = await this.cache.fetch(url);
    const selector = fieldSelector(definition);
    const output = definition.outputs[0];
    const distributionRequested = wantsDistribution(query);

    let statistics: AreaSummaryResult["statistics"];
    let distribution: AreaSummaryResult["distribution"] | undefined;
    let temporal: SelectedMessageTemporal;
    if (distributionRequested) {
      const extracted = await this.gridDecoder.extractSelectedMessage(cached.path, box, selector);
      temporal = extracted.temporal;
      const points = normalizeGridPoints(extracted.points, (value) => normalizeFieldValue(definition, value));
      const computed = computeAreaDistribution(points, query);
      statistics = publicStatistics(computed.statistics.definedGridPoints, computed.statistics);
      distribution = computed.distribution;
    } else {
      const rawStats = await this.decoder.summarizeSelectedMessage(cached.path, box, selector);
      temporal = rawStats.temporal;
      statistics = publicStatistics(rawStats.definedGridPoints, normalizeFieldStats(definition, rawStats));
    }

    return {
      model: query.grid === "0p50" ? "gfs_0p50" : "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      bbox: box,
      field: {
        id: definition.id,
        level: publicLevel(definition.level),
        temporal: publicTemporal(temporal, run),
        output: { field: output.field, unit: output.unit },
      },
      statistics,
      ...(distribution === undefined ? {} : { distribution }),
      source: areaSource(
        cached.cacheHit,
        distributionRequested ? this.gridDecoder.engine ?? "wgrib2" : this.decoder.engine ?? "wgrib2",
      ),
    };
  }

  private async resolveRun(
    selector: ReturnType<typeof areaSummaryQuerySchema.parse>["run"],
    validTime: Date,
    variables: RawVariableDefinition[],
    pressureLevelsHpa: number[],
    fields: RawNonIsobaricFieldDefinition[],
    grid: "0p25" | "0p50" = "0p25",
  ): Promise<Date> {
    return selector === "latest"
      ? resolveLatestRunForGrid(this.latestRunProvider, {
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        }, grid)
      : selector === "latest_complete"
        ? resolveLatestCompleteRunForGrid(this.latestRunProvider, grid)
        : parseGfsRun(selector);
  }
}

export function estimateGridPoints(box: AreaBox, grid: "0p25" | "0p50" = "0p25"): number {
  const spacing = gfsGridSpacingDegrees(grid);
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / spacing) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / spacing) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function wantsDistribution(query: ReturnType<typeof areaSummaryQuerySchema.parse>): boolean {
  return query.includeExtremaLocations
    || (query.percentiles?.length ?? 0) > 0
    || (query.thresholds?.length ?? 0) > 0;
}

function fieldSelector(definition: RawNonIsobaricFieldDefinition): AreaMessageSelector {
  return {
    code: definition.gfsCode,
    gribLevel: definition.level.gribLevel,
    temporalSemantics: definition.temporalSemantics,
  };
}

function normalizeGridPoints(
  points: readonly GridValuePoint[],
  normalize: (value: number) => number,
): GridValuePoint[] {
  return points.map((point) => ({ ...point, value: normalize(point.value) }));
}

function normalizePressureValue(variable: RawVariableId, value: number): number {
  return variable === "temperature" ? value - 273.15 : value;
}

function normalizeFieldValue(definition: RawNonIsobaricFieldDefinition, value: number): number {
  const output = definition.outputs[0];
  return definition.sourceUnit === "K" && output.unit === "degC" ? value - 273.15 : value;
}

function normalizePressureStats(variable: RawVariableId, stats: GridStatistics) {
  return {
    mean: normalizePressureValue(variable, stats.mean),
    min: normalizePressureValue(variable, stats.min),
    max: normalizePressureValue(variable, stats.max),
  };
}

function normalizeFieldStats(
  definition: RawNonIsobaricFieldDefinition,
  stats: GridStatistics,
): { mean: number; min: number; max: number } {
  return {
    mean: normalizeFieldValue(definition, stats.mean),
    min: normalizeFieldValue(definition, stats.min),
    max: normalizeFieldValue(definition, stats.max),
  };
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

function areaSource(cacheHit: boolean, decoder: GribDecoderName): AreaSummaryResult["source"] {
  return {
    provider: "NOAA NOMADS",
    access: "nomads_grib_filter",
    decoder,
    cacheHit,
  };
}
