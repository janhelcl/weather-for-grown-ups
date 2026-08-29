import { homedir } from "node:os";
import { join } from "node:path";
import { IfsOpenDataSubsetCache, type IfsSelectionSource } from "../cache/ifs-open-data-cache.js";
import {
  IFS_FIELD_CATALOG,
  IFS_RAW_PRESSURE_VARIABLE_CATALOG,
  type IfsRawFieldId,
  type IfsRawPressureVariableId,
} from "../catalog/ifs.js";
import { NON_ISOBARIC_FIELD_CATALOG, type NonIsobaricLevel } from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  gridPointsInBox,
  readGribMessages,
  type GribBox,
  type GribGridPoint,
} from "../grib/gribberish-runtime.js";
import {
  ifsAreaSummaryQuerySchema,
  ifsAreaSummaryResultSchema,
  type IfsAreaSummaryQueryInput,
  type IfsAreaSummaryResult,
} from "../schema/ifs-area-summary.js";
import type { FieldTemporalResult, NonIsobaricFieldLevelResult } from "./types.js";
import { computeAreaDistribution } from "./area-distribution.js";
import { IfsLatestRunResolver, type IfsLatestRunProvider } from "./ifs-latest-run.js";
import { ifsForecastHour, parseIfsRun } from "./ifs-time.js";

const HOUR_MS = 3_600_000;
const IFS_GRID_SPACING_DEG = 0.25;

export interface IfsAreaGridDecoder {
  readonly engine?: "gribberish";
  extractBox(path: string, box: GribBox): Promise<GribGridPoint[]>;
}

export interface IfsAreaSummaryServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  decoder?: IfsAreaGridDecoder;
  latestRunProvider?: IfsLatestRunProvider;
}

export class IfsAreaSummaryService {
  private readonly source: IfsSelectionSource;
  private readonly decoder: IfsAreaGridDecoder;
  private readonly latestRunProvider: IfsLatestRunProvider;

  constructor(options: IfsAreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.decoder = options.decoder ?? new BundledIfsAreaGridDecoder();
    this.latestRunProvider = options.latestRunProvider ?? new IfsLatestRunResolver({ cacheDir });
  }

  async summarize(input: IfsAreaSummaryQueryInput): Promise<IfsAreaSummaryResult> {
    const query = ifsAreaSummaryQuerySchema.parse(input);
    const box: GribBox = {
      westLongitude: query.westLongitude,
      eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude,
      northLatitude: query.northLatitude,
    };
    const estimatedGridPoints = estimateIfsGridPoints(box);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new Error(
        `Requested bbox is approximately ${estimatedGridPoints} IFS grid points at 0.25°, exceeding maxGridPoints=${query.maxGridPoints}`,
      );
    }
    return query.field === undefined
      ? this.summarizePressure(query, box)
      : this.summarizeField(query, box);
  }

  private async summarizePressure(
    query: ReturnType<typeof ifsAreaSummaryQuerySchema.parse>,
    box: GribBox,
  ): Promise<IfsAreaSummaryResult> {
    if (query.variable === undefined || query.pressureLevelHpa === undefined) {
      throw new Error("Internal IFS area validation error: pressure selection is incomplete");
    }
    const rawId: IfsRawPressureVariableId =
      query.variable === "absolute_vorticity" ? "relative_vorticity" : query.variable;
    const variable = IFS_RAW_PRESSURE_VARIABLE_CATALOG[rawId];
    const selector = {
      key: `${query.variable}@${query.pressureLevelHpa}`,
      param: variable.param,
      levtype: "pl" as const,
      levelist: query.pressureLevelHpa,
    };
    const { run, forecastHour } = await this.resolveRun(query.run, query.validTime, selector);
    const cached = await this.source.fetchSelection({
      run,
      forecastHour,
      selectors: [selector],
    });
    const points = normalizePressurePoints(
      await this.decoder.extractBox(cached.path, box),
      query.variable,
    );
    const computed = computeAreaDistribution(points, query);
    const output = VARIABLE_CATALOG[query.variable].outputs[0];
    if (!output) throw new Error(`IFS pressure variable ${query.variable} has no public output`);

    return ifsAreaSummaryResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      validTime: new Date(query.validTime).toISOString(),
      forecastHour,
      bbox: box,
      variable: {
        id: query.variable,
        pressureHpa: query.pressureLevelHpa,
        field: output.field,
        unit: output.unit,
      },
      statistics: publicStatistics(computed.statistics),
      ...(hasDistribution(query) ? { distribution: computed.distribution } : {}),
      source: source(cached.cacheHit),
    });
  }

  private async summarizeField(
    query: ReturnType<typeof ifsAreaSummaryQuerySchema.parse>,
    box: GribBox,
  ): Promise<IfsAreaSummaryResult> {
    if (query.field === undefined) throw new Error("Internal IFS area validation error: field is missing");
    const definition = IFS_FIELD_CATALOG[query.field];
    if (definition.kind !== "raw") {
      throw new Error(`IFS area summary supports raw fields only; ${query.field} is derived`);
    }
    const selector = {
      key: query.field,
      param: definition.param,
      levtype: definition.levtype,
      ...(definition.sourceForecastHour === undefined
        ? {}
        : { sourceForecastHour: definition.sourceForecastHour }),
    };
    const { run, forecastHour } = await this.resolveRun(query.run, query.validTime, selector);
    const sourceForecastHour = definition.sourceForecastHour ?? forecastHour;
    const cached = await this.source.fetchSelection({
      run,
      forecastHour: sourceForecastHour,
      selectors: [selector],
    });
    const points = normalizePoints(
      await this.decoder.extractBox(cached.path, box),
      (value) => normalizeFieldValue(query.field!, value),
    );
    const computed = computeAreaDistribution(points, query);
    const canonical = NON_ISOBARIC_FIELD_CATALOG[query.field];
    const output = canonical.outputs[0];
    if (!output) throw new Error(`IFS field ${query.field} has no public output`);

    return ifsAreaSummaryResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      validTime: new Date(query.validTime).toISOString(),
      forecastHour,
      bbox: box,
      field: {
        id: query.field,
        level: publicLevel(canonical.level),
        temporal: publicTemporal(definition.temporalSemantics, run, forecastHour),
        output: { field: output.field, unit: output.unit },
      },
      statistics: publicStatistics(computed.statistics),
      ...(hasDistribution(query) ? { distribution: computed.distribution } : {}),
      source: source(cached.cacheHit),
    });
  }

  private async resolveRun(
    selector: ReturnType<typeof ifsAreaSummaryQuerySchema.parse>["run"],
    validTimeIso: string,
    fieldSelector: {
      key: string;
      param: string;
      levtype: "pl" | "sfc";
      levelist?: number;
      sourceForecastHour?: number;
    },
  ): Promise<{ run: Date; forecastHour: number }> {
    const validTime = new Date(validTimeIso);
    const run = selector === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, [fieldSelector])
      : parseIfsRun(selector);
    return { run, forecastHour: ifsForecastHour(run, validTime) };
  }
}

class BundledIfsAreaGridDecoder implements IfsAreaGridDecoder {
  readonly engine = "gribberish" as const;

  async extractBox(path: string, box: GribBox): Promise<GribGridPoint[]> {
    const messages = await readGribMessages(path);
    if (messages.length !== 1) {
      throw new Error(`IFS area decoder expected one selected GRIB message, found ${messages.length}`);
    }
    return gridPointsInBox(messages[0]!, box);
  }
}

export function estimateIfsGridPoints(box: GribBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / IFS_GRID_SPACING_DEG) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / IFS_GRID_SPACING_DEG) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizePoints(
  points: readonly GribGridPoint[],
  normalize: (value: number) => number,
): GribGridPoint[] {
  return points.map((point) => ({ ...point, value: normalize(point.value) }));
}

function normalizePressurePoints(
  points: readonly GribGridPoint[],
  id: ReturnType<typeof ifsAreaSummaryQuerySchema.parse>["variable"],
): GribGridPoint[] {
  if (id === "temperature") {
    return normalizePoints(points, (value) => value - 273.15);
  }
  if (id === "absolute_vorticity") {
    return points.map((point) => ({
      ...point,
      value: point.value + coriolisParameterS1(point.latitude),
    }));
  }
  return [...points];
}

function coriolisParameterS1(latitudeDeg: number): number {
  const earthAngularVelocityS1 = 7.292115e-5;
  return 2 * earthAngularVelocityS1 * Math.sin(latitudeDeg * Math.PI / 180);
}

function normalizeFieldValue(id: IfsRawFieldId, value: number): number {
  const definition = IFS_FIELD_CATALOG[id];
  if (definition.kind !== "raw") throw new Error(`Internal IFS raw-field normalization error for ${id}`);
  const output = NON_ISOBARIC_FIELD_CATALOG[id].outputs[0];
  if (!output) throw new Error(`IFS field ${id} has no public output`);
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  if (definition.sourceUnit === "m" && output.unit === "mm") return value * 1000;
  if (definition.sourceUnit === "fraction" && output.unit === "%") return value * 100;
  if (id === "surface_geopotential_height") return value / 9.80665;
  return value;
}

function publicLevel(level: NonIsobaricLevel): NonIsobaricFieldLevelResult {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m": return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function publicTemporal(
  semantics: "instantaneous" | "accumulation",
  run: Date,
  forecastHour: number,
): FieldTemporalResult {
  if (semantics === "instantaneous") return { type: "instantaneous" };
  return {
    type: "accumulation",
    startForecastHour: 0,
    endForecastHour: forecastHour,
    startTime: run.toISOString(),
    endTime: new Date(run.getTime() + forecastHour * HOUR_MS).toISOString(),
  };
}

function publicStatistics(
  stats: { definedGridPoints: number; mean: number; min: number; max: number },
): IfsAreaSummaryResult["statistics"] {
  return {
    definedGridPoints: stats.definedGridPoints,
    mean: stats.mean,
    min: stats.min,
    max: stats.max,
    meanKind: "unweighted_grid_point_mean",
  };
}

function hasDistribution(query: ReturnType<typeof ifsAreaSummaryQuerySchema.parse>): boolean {
  return query.includeExtremaLocations
    || (query.percentiles?.length ?? 0) > 0
    || (query.thresholds?.length ?? 0) > 0;
}

function source(cacheHit: boolean): IfsAreaSummaryResult["source"] {
  return {
    provider: "ECMWF Open Data",
    access: "indexed_http_range",
    decoder: "gribberish",
    product: "ifs_0p25_oper_fc",
    horizontalGridDegrees: 0.25,
    cacheHit,
  };
}
