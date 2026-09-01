import { homedir } from "node:os";
import { join } from "node:path";
import {
  AromeOpenDataCache,
  aromePackagesForFields,
  type AromeDataRequest,
  type AromeSourceFile,
  type AromeSubsetCache,
} from "../cache/arome-open-data-cache.js";
import { expandArome0p01RequestedFields } from "../catalog/arome.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
  type RawNonIsobaricFieldDefinition,
} from "../catalog/non-isobaric-fields.js";
import {
  Wgrib2GridDecoder,
  type GridValuePoint,
} from "../grib/wgrib2-grid.js";
import {
  Wgrib2StatsDecoder,
  type AreaBox,
  type AreaMessageSelector,
  type GridStatistics,
  type SelectedMessageTemporal,
} from "../grib/wgrib2-stats.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import type { PointCoordinate } from "../schema/query.js";
import {
  aromeForecastHour,
  aromeNativeForecastHoursInRange,
  aromeValidTime,
} from "../sources/arome.js";
import { computeAreaDistribution } from "./area-distribution.js";
import {
  AromeRunResolver,
  resolveAromeRun,
  type AromeRunProvider,
} from "./arome-run.js";
import {
  assertFieldsComplete,
  buildFieldResult,
} from "./profile.js";
import {
  greatCircleDistanceKm,
  interpolateGreatCircle,
} from "./transect.js";
import type {
  DecodedValue,
  GribDecoderName,
  NonIsobaricFieldResult,
} from "./types.js";

const MODEL = "arome_0p01" as const;
const MAX_NATIVE_STEPS = 52;

export interface AromePointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface AromeForecastServiceOptions {
  cacheDir?: string;
  cache?: AromeSubsetCache;
  decoder?: AromePointDecoder;
  runProvider?: AromeRunProvider;
  areaDecoder?: Wgrib2StatsDecoder;
  areaGridDecoder?: Wgrib2GridDecoder;
}

interface ExpandedSelection {
  fieldIds: NonIsobaricFieldId[];
  fields: RawNonIsobaricFieldDefinition[];
}

interface AromePointResult {
  model: typeof MODEL;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: PointCoordinate;
  gridPoint: PointCoordinate;
  levels: [];
  fields: NonIsobaricFieldResult[];
  source: ReturnType<typeof pointSource>;
}

export class AromeForecastService {
  private readonly cache: AromeSubsetCache;
  private readonly decoder: AromePointDecoder;
  private readonly runProvider: AromeRunProvider;
  private readonly areaDecoder: Wgrib2StatsDecoder;
  private readonly areaGridDecoder: Wgrib2GridDecoder;

  constructor(options: AromeForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.cache = options.cache ?? new AromeOpenDataCache(join(cacheDir, "arome-0p01"));
    this.decoder = options.decoder ?? new Wgrib2Decoder();
    this.runProvider = options.runProvider ?? new AromeRunResolver(this.cache);
    this.areaDecoder = options.areaDecoder ?? new Wgrib2StatsDecoder();
    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "arome") {
      throw new Error("AROME service only accepts dataset=arome");
    }
    if (request.geometry.type === "point") {
      return "at" in request.time
        ? this.getPoint(request)
        : this.getTimeSeries(request);
    }
    if (request.geometry.type === "points") {
      return "at" in request.time
        ? this.getPoints(request)
        : this.getPointsTimeSeries(request);
    }
    if (request.geometry.type === "transect") return this.getTransect(request);
    return this.getAreaSummary(request);
  }

  private async getPoint(request: QueryAtmosphereRequest): Promise<AromePointResult> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal AROME routing error: expected point instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: aromePackagesForFields(selection.fields),
    });
    return this.pointAt(run, validTime, request.geometry, selection);
  }

  private async getTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal AROME routing error: expected point time range");
    }
    const selection = expandedSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "time_range",
      startTime,
      endTime,
      products: aromePackagesForFields(selection.fields),
    });
    const forecastHours = boundedForecastHours(
      run,
      startTime,
      endTime,
      request.time.maxSteps,
    );

    const points: AromePointResult[] = [];
    for (const forecastHour of forecastHours) {
      points.push(await this.pointAt(
        run,
        aromeValidTime(run, forecastHour),
        request.geometry,
        selection,
      ));
    }
    const first = points[0]!;
    return {
      model: MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: request.geometry.latitude, longitude: request.geometry.longitude },
      gridPoint: first.gridPoint,
      source: sourceWithoutCache(first.source),
      series: points.map((point) => ({
        validTime: point.validTime,
        forecastHour: point.forecastHour,
        levels: [],
        fields: point.fields,
        cacheHit: point.source.cacheHit,
      })),
    };
  }

  private async getPoints(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal AROME routing error: expected points instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: aromePackagesForFields(selection.fields),
    });
    return this.pointsAt(run, validTime, request.geometry.points, selection);
  }

  private async getPointsTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal AROME routing error: expected points time range");
    }
    const selection = expandedSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "time_range",
      startTime,
      endTime,
      products: aromePackagesForFields(selection.fields),
    });
    const forecastHours = boundedForecastHours(
      run,
      startTime,
      endTime,
      request.time.maxSteps,
    );
    const pointSteps = request.geometry.points.length * forecastHours.length;
    const maxPointSteps = request.limits?.maxPointSteps ?? request.limits?.maxSamples ?? 5_000;
    if (pointSteps > maxPointSteps) {
      throw new Error(
        `Requested AROME matrix contains ${request.geometry.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${maxPointSteps}`,
      );
    }

    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        aromeValidTime(run, forecastHour),
        request.geometry.points,
        selection,
      ));
    }
    const first = batches[0]!;
    return {
      model: MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      source: sourceWithoutCache(first.source),
      series: batches.map((batch) => ({
        validTime: batch.validTime,
        forecastHour: batch.forecastHour,
        points: batch.points,
        cacheHit: batch.source.cacheHit,
      })),
    };
  }

  private async getTransect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal AROME routing error: expected transect instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: aromePackagesForFields(selection.fields),
    });
    const samples = request.geometry.samples ?? 21;
    const points = interpolateGreatCircle(request.geometry.start, request.geometry.end, samples);
    const batch: any = await this.pointsAt(run, validTime, points, selection);
    const totalDistanceKm = greatCircleDistanceKm(request.geometry.start, request.geometry.end);

    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: aromeForecastHour(run, validTime),
      startPoint: { ...request.geometry.start },
      endPoint: { ...request.geometry.end },
      totalDistanceKm,
      variables: [],
      pressureLevelsHpa: [],
      fields: selection.fieldIds,
      samples: batch.points.map((point: any, index: number) => ({
        index,
        fraction: index / (points.length - 1),
        distanceKm: totalDistanceKm * index / (points.length - 1),
        ...point,
      })),
      source: batch.source,
    };
  }

  private async getAreaSummary(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal AROME routing error: expected area instant query");
    }
    const selection = expandedSelection(request);
    const box: AreaBox = {
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
    };
    const estimatedGridPoints = estimateAromeGridPoints(box);
    const maxGridPoints = request.limits?.maxGridPoints ?? 1_100_000;
    if (estimatedGridPoints > maxGridPoints) {
      throw new Error(
        `Requested bbox is approximately ${estimatedGridPoints} AROME 0.01° grid points, exceeding maxGridPoints=${maxGridPoints}`,
      );
    }

    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: aromePackagesForFields(selection.fields),
    });
    const forecastHour = aromeForecastHour(run, validTime);
    const cached = await this.cache.fetch(dataRequest(run, forecastHour, selection, box));
    const field = selection.fields[0]!;
    const selector = fieldSelector(field);
    const distributionRequested = wantsDistribution(request);
    const extracted = distributionRequested
      ? await this.areaGridDecoder.extractSelectedMessage(cached.path, box, selector)
      : undefined;
    const summarized = extracted === undefined
      ? await this.areaDecoder.summarizeSelectedMessage(cached.path, box, selector)
      : undefined;
    const temporal = extracted?.temporal ?? summarized!.temporal;
    const distribution = extracted === undefined
      ? undefined
      : computeAreaDistribution(
          normalizeGridPoints(extracted.points, (value) => normalizeFieldValue(field, value)),
          distributionOptions(request),
        );
    const normalizedStats = summarized === undefined
      ? undefined
      : normalizeFieldStats(field, summarized);

    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      bbox: box,
      field: {
        id: field.id,
        level: publicFieldLevel(field),
        temporal: publicTemporal(temporal, run),
        output: { ...field.outputs[0]! },
      },
      statistics: distribution === undefined
        ? publicStatistics(summarized!.definedGridPoints, normalizedStats!)
        : publicStatistics(distribution.statistics.definedGridPoints, distribution.statistics),
      ...(distribution === undefined ? {} : { distribution: distribution.distribution }),
      source: areaSource(cached.cacheHit, distributionRequested
        ? this.areaGridDecoder.engine
        : this.areaDecoder.engine),
    };
  }

  private async pointsAt(
    run: Date,
    validTime: Date,
    points: readonly PointCoordinate[],
    selection: ExpandedSelection,
  ): Promise<unknown> {
    const forecastHour = aromeForecastHour(run, validTime);
    const cached = await this.cache.fetch(
      dataRequest(run, forecastHour, selection, subsetForPoints(points)),
    );
    const results: AromePointResult[] = [];
    for (const point of points) {
      results.push(await this.decodePoint(cached, run, validTime, point, selection));
    }
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      points: results.map((result) => ({
        requestedPoint: result.requestedPoint,
        gridPoint: result.gridPoint,
        levels: [],
        fields: result.fields,
      })),
      source: pointSource(cached.cacheHit, this.decoder.engine),
    };
  }

  private async pointAt(
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<AromePointResult> {
    const forecastHour = aromeForecastHour(run, validTime);
    const cached = await this.cache.fetch(
      dataRequest(run, forecastHour, selection, subsetForPoints([point])),
    );
    return this.decodePoint(cached, run, validTime, point, selection);
  }

  private async decodePoint(
    cached: AromeSourceFile,
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<AromePointResult> {
    const decoded = await this.decoder.extractPoint(cached.path, point.longitude, point.latitude);
    const firstValue = decoded[0];
    if (firstValue === undefined) throw new Error("AROME decoder returned no grid point");
    assertFieldsComplete(decoded, selection.fields);
    const fields = selection.fieldIds.map((id) =>
      buildFieldResult(NON_ISOBARIC_FIELD_CATALOG[id], decoded, run));

    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: aromeForecastHour(run, validTime),
      requestedPoint: { latitude: point.latitude, longitude: point.longitude },
      gridPoint: firstValue.gridPoint,
      levels: [],
      fields,
      source: pointSource(cached.cacheHit, this.decoder.engine),
    };
  }

  private resolveRun(
    selector: string,
    requirement: Parameters<typeof resolveAromeRun>[1],
  ): Promise<Date> {
    return Promise.resolve(resolveAromeRun(selector, requirement, this.runProvider));
  }
}

function expandedSelection(request: QueryAtmosphereRequest): ExpandedSelection {
  const fieldIds = (request.selection.fields ?? []) as NonIsobaricFieldId[];
  return {
    fieldIds: [...fieldIds],
    fields: expandArome0p01RequestedFields(fieldIds),
  };
}

function dataRequest(
  run: Date,
  forecastHour: number,
  selection: ExpandedSelection,
  subset?: AromeDataRequest["subset"],
): AromeDataRequest {
  return {
    run,
    forecastHour,
    fields: selection.fields,
    ...(subset === undefined ? {} : { subset }),
  };
}

function subsetForPoints(points: readonly PointCoordinate[]): NonNullable<AromeDataRequest["subset"]> {
  if (points.length === 0) throw new Error("AROME source subset requires at least one point");
  const padding = 0.05;
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  return {
    westLongitude: Math.max(-180, Math.min(...longitudes) - padding),
    eastLongitude: Math.min(180, Math.max(...longitudes) + padding),
    southLatitude: Math.max(-90, Math.min(...latitudes) - padding),
    northLatitude: Math.min(90, Math.max(...latitudes) + padding),
  };
}

function boundedForecastHours(
  run: Date,
  startTime: Date,
  endTime: Date,
  requestedMaxSteps: number | undefined,
): number[] {
  const hours = aromeNativeForecastHoursInRange(run, startTime, endTime);
  const maxSteps = requestedMaxSteps ?? MAX_NATIVE_STEPS;
  if (hours.length > maxSteps) {
    throw new Error(
      `Requested time range contains ${hours.length} native AROME outputs, exceeding maxSteps=${maxSteps}`,
    );
  }
  return hours;
}

function sourceWithoutCache(source: AromePointResult["source"]) {
  const { cacheHit: _cacheHit, ...rest } = source;
  return rest;
}

function wantsDistribution(request: QueryAtmosphereRequest): boolean {
  return (request.aggregate?.percentiles?.length ?? 0) > 0
    || (request.aggregate?.thresholds?.length ?? 0) > 0
    || request.aggregate?.includeExtremaLocations === true;
}

function distributionOptions(request: QueryAtmosphereRequest) {
  return {
    ...(request.aggregate?.percentiles === undefined
      ? {}
      : { percentiles: request.aggregate.percentiles }),
    ...(request.aggregate?.thresholds === undefined
      ? {}
      : { thresholds: request.aggregate.thresholds }),
    includeExtremaLocations: request.aggregate?.includeExtremaLocations ?? false,
  };
}

function estimateAromeGridPoints(box: AreaBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / 0.01) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / 0.01) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizeGridPoints(
  points: readonly GridValuePoint[],
  normalize: (value: number) => number,
): GridValuePoint[] {
  return points.map((point) => ({ ...point, value: normalize(point.value) }));
}

function normalizeFieldValue(definition: RawNonIsobaricFieldDefinition, value: number): number {
  const output = definition.outputs[0]!;
  return definition.sourceUnit === "K" && output.unit === "degC"
    ? value - 273.15
    : value;
}

function normalizeFieldStats(
  definition: RawNonIsobaricFieldDefinition,
  stats: GridStatistics,
): GridStatistics {
  return {
    ...stats,
    mean: normalizeFieldValue(definition, stats.mean),
    min: normalizeFieldValue(definition, stats.min),
    max: normalizeFieldValue(definition, stats.max),
  };
}

function publicStatistics(
  definedGridPoints: number,
  stats: { mean: number; min: number; max: number },
) {
  return {
    definedGridPoints,
    mean: stats.mean,
    min: stats.min,
    max: stats.max,
    meanKind: "unweighted_grid_point_mean" as const,
  };
}

function fieldSelector(definition: RawNonIsobaricFieldDefinition): AreaMessageSelector {
  return {
    code: definition.gfsCode,
    gribLevel: definition.level.gribLevel,
    temporalSemantics: definition.temporalSemantics,
  };
}

function publicFieldLevel(definition: RawNonIsobaricFieldDefinition): any {
  switch (definition.level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m":
      return { type: "height_above_ground_m", heightM: definition.level.heightM };
    case "named_layer":
      return { type: "named_layer", id: definition.level.id };
    case "named_level":
      return { type: "named_level", id: definition.level.id };
  }
}

function publicTemporal(temporal: SelectedMessageTemporal, run: Date): any {
  if (temporal.type === "instantaneous") return { type: "instantaneous" };
  return {
    type: temporal.type,
    startForecastHour: temporal.startForecastHour,
    endForecastHour: temporal.endForecastHour,
    startTime: new Date(run.getTime() + temporal.startForecastHour * 3_600_000).toISOString(),
    endTime: new Date(run.getTime() + temporal.endForecastHour * 3_600_000).toISOString(),
  };
}

function pointSource(cacheHit: boolean, decoder: GribDecoderName | undefined) {
  return {
    provider: "Météo-France Open Data" as const,
    access: "meteo_france_open_data" as const,
    decoder: decoder ?? "gribberish",
    nativeGrid: {
      type: "lambert_conformal" as const,
      nominalResolutionKm: 1.3 as const,
    },
    productGrid: {
      type: "regular_latlon" as const,
      resolutionDegrees: 0.01 as const,
      product: "EURW1S100" as const,
    },
    cacheHit,
  };
}

function areaSource(cacheHit: boolean, decoder: GribDecoderName | undefined) {
  return pointSource(cacheHit, decoder);
}
