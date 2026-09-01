import { homedir } from "node:os";
import { join } from "node:path";
import {
  IconD2OpenDataCache,
  type IconD2DataRequest,
  type IconD2SourceFile,
  type IconD2SubsetCache,
} from "../cache/icon-d2-open-data-cache.js";
import {
  ICON_D2_RAW_PRESSURE_VARIABLE_IDS,
  expandIconD2RequestedFields,
  expandIconD2RequestedVariables,
  iconD2FieldDefinition,
} from "../catalog/icon-d2.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
  type RawNonIsobaricFieldDefinition,
} from "../catalog/non-isobaric-fields.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import {
  VARIABLE_CATALOG,
  type RawVariableDefinition,
} from "../catalog/variables.js";
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
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type {
  PointCoordinate,
  VariableId,
} from "../schema/query.js";
import { computeAreaDistribution } from "./area-distribution.js";
import {
  IconD2RunResolver,
  resolveIconD2Run,
  type IconD2RunProvider,
} from "./icon-d2-run.js";
import {
  iconD2ForecastHour,
  iconD2NativeForecastHoursInRange,
  iconD2ValidTime,
} from "../sources/icon-d2.js";
import {
  applyDecodedPressureValue,
  applyDerivedPressureValues,
  assertFieldsComplete,
  assertPressureComplete,
  buildFieldResult,
} from "./profile.js";
import {
  deriveLayerDiagnosticsFromLevels,
  deriveProfileDiagnosticsFromLevels,
} from "./pressure-diagnostics.js";
import {
  greatCircleDistanceKm,
  interpolateGreatCircle,
} from "./transect.js";
import type {
  DecodedValue,
  GribDecoderName,
  NonIsobaricFieldResult,
  ProfileLevel,
} from "./types.js";

const MODEL = "icon_d2_0p02" as const;
const MAX_NATIVE_STEPS = 49;

export interface IconD2PointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface IconD2ForecastServiceOptions {
  cacheDir?: string;
  cache?: IconD2SubsetCache;
  decoder?: IconD2PointDecoder;
  runProvider?: IconD2RunProvider;
  areaDecoder?: Wgrib2StatsDecoder;
  areaGridDecoder?: Wgrib2GridDecoder;
}

interface ExpandedSelection {
  variableIds: VariableId[];
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fieldIds: NonIsobaricFieldId[];
  fields: RawNonIsobaricFieldDefinition[];
}

interface IconD2ProfileResult {
  model: typeof MODEL;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: PointCoordinate;
  gridPoint: PointCoordinate;
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
  source: {
    provider: "DWD Open Data";
    access: "dwd_open_data";
    decoder: GribDecoderName;
    productGrid: {
      type: "regular_latlon";
      resolutionDegrees: 0.02;
      interpolation: "dwd_open_data";
    };
    cacheHit: boolean;
  };
}

export class IconD2ForecastService {
  private readonly cache: IconD2SubsetCache;
  private readonly decoder: IconD2PointDecoder;
  private readonly runProvider: IconD2RunProvider;
  private readonly areaDecoder: Wgrib2StatsDecoder;
  private readonly areaGridDecoder: Wgrib2GridDecoder;

  constructor(options: IconD2ForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.cache = options.cache ?? new IconD2OpenDataCache(join(cacheDir, "icon-d2"));
    this.decoder = options.decoder ?? new Wgrib2Decoder();
    this.runProvider = options.runProvider ?? new IconD2RunResolver(this.cache);
    this.areaDecoder = options.areaDecoder ?? new Wgrib2StatsDecoder();
    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "icon-d2") {
      throw new Error("ICON-D2 service only accepts dataset=icon-d2");
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

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "icon-d2") {
      throw new Error("ICON-D2 service only accepts dataset=icon-d2");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error("ICON-D2 does not expose parcel diagnostics because its surface product lacks the required parcel initialization state");
    }
    return "at" in request.time
      ? this.getInstantDiagnostic(request)
      : this.getDiagnosticTimeSeries(request);
  }

  private async getPoint(request: QueryAtmosphereRequest): Promise<IconD2ProfileResult> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal ICON-D2 routing error: expected point instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: productsFor(selection),
    });
    return this.profileAt(
      run,
      validTime,
      request.geometry,
      selection,
    );
  }

  private async getTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal ICON-D2 routing error: expected point time range");
    }
    const selection = expandedSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "time_range",
      startTime,
      endTime,
      products: productsFor(selection),
    });
    const forecastHours = boundedForecastHours(
      run,
      startTime,
      endTime,
      request.time.maxSteps,
    );

    const profiles: IconD2ProfileResult[] = [];
    for (const forecastHour of forecastHours) {
      profiles.push(await this.profileAt(
        run,
        iconD2ValidTime(run, forecastHour),
        request.geometry,
        selection,
      ));
    }
    const first = profiles[0]!;
    return {
      model: MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: request.geometry.latitude, longitude: request.geometry.longitude },
      gridPoint: first.gridPoint,
      source: sourceWithoutCache(first.source),
      series: profiles.map((profile) => ({
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
        cacheHit: profile.source.cacheHit,
      })),
    };
  }

  private async getPoints(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal ICON-D2 routing error: expected points instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: productsFor(selection),
    });
    return this.pointsAt(run, validTime, request.geometry.points, selection);
  }

  private async getPointsTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal ICON-D2 routing error: expected points time range");
    }
    const selection = expandedSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "time_range",
      startTime,
      endTime,
      products: productsFor(selection),
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
        `Requested ICON-D2 matrix contains ${request.geometry.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${maxPointSteps}`,
      );
    }

    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        iconD2ValidTime(run, forecastHour),
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
      throw new Error("Internal ICON-D2 routing error: expected transect instant query");
    }
    const selection = expandedSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: productsFor(selection),
    });
    const samples = request.geometry.samples ?? 21;
    const points = interpolateGreatCircle(request.geometry.start, request.geometry.end, samples);
    const batch: any = await this.pointsAt(run, validTime, points, selection);
    const totalDistanceKm = greatCircleDistanceKm(request.geometry.start, request.geometry.end);

    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: iconD2ForecastHour(run, validTime),
      startPoint: { ...request.geometry.start },
      endPoint: { ...request.geometry.end },
      totalDistanceKm,
      variables: selection.variableIds,
      pressureLevelsHpa: selection.pressureLevelsHpa,
      ...(selection.fieldIds.length === 0 ? {} : { fields: selection.fieldIds }),
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
      throw new Error("Internal ICON-D2 routing error: expected area instant query");
    }
    const selection = expandedSelection(request);
    const box: AreaBox = {
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
    };
    const estimatedGridPoints = estimateIconD2GridPoints(box);
    const maxGridPoints = request.limits?.maxGridPoints ?? 1_100_000;
    if (estimatedGridPoints > maxGridPoints) {
      throw new Error(
        `Requested bbox is approximately ${estimatedGridPoints} ICON-D2 grid points, exceeding maxGridPoints=${maxGridPoints}`,
      );
    }

    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: productsFor(selection),
    });
    const forecastHour = iconD2ForecastHour(run, validTime);
    const cached = await this.cache.fetch(dataRequest(run, forecastHour, selection));
    const distributionRequested = wantsDistribution(request);

    if (selection.variables.length === 1 && selection.pressureLevelsHpa.length === 1) {
      const variable = selection.variables[0]!;
      const output = variable.outputs[0]!;
      const decoded = distributionRequested
        ? await this.areaGridDecoder.extractBox(cached.path, box)
        : undefined;
      const statistics = decoded === undefined
        ? normalizePressureStats(variable.id, await this.areaDecoder.summarizeBox(cached.path, box))
        : undefined;
      const distribution = decoded === undefined
        ? undefined
        : computeAreaDistribution(
            normalizeGridPoints(decoded, (value) => normalizePressureValue(variable.id, value)),
            distributionOptions(request),
          );
      return {
        model: MODEL,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        bbox: box,
        variable: {
          id: variable.id,
          pressureHpa: selection.pressureLevelsHpa[0],
          field: output.field,
          unit: output.unit,
        },
        statistics: distribution === undefined
          ? publicStatistics((statistics as GridStatistics).definedGridPoints, statistics as GridStatistics)
          : publicStatistics(distribution.statistics.definedGridPoints, distribution.statistics),
        ...(distribution === undefined ? {} : { distribution: distribution.distribution }),
        source: areaSource(cached.cacheHit, distributionRequested
          ? this.areaGridDecoder.engine
          : this.areaDecoder.engine),
      };
    }

    const field = selection.fields[0]!;
    const selector = fieldSelector(field);
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

  private async getInstantDiagnostic(
    request: DiagnoseAtmosphereRequest,
    explicitRun?: Date,
  ): Promise<unknown> {
    if (!("at" in request.time)) {
      throw new Error("Internal ICON-D2 routing error: expected instant diagnostic");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error("ICON-D2 parcel diagnostics are not supported");
    }
    const validTime = new Date(request.time.at);
    const pressureLevelsHpa = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const variableIds = request.diagnostic.kind === "layer"
      ? expandLayerDiagnosticVariables(request.diagnostic.diagnostics)
      : expandProfileDiagnosticVariables(request.diagnostic.diagnostics);
    const selection = expandSelection(variableIds, pressureLevelsHpa, []);
    const run = explicitRun ?? await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "valid_time",
      validTime,
      products: productsFor(selection),
    });
    const profile = await this.profileAt(run, validTime, request.geometry, selection);

    if (request.diagnostic.kind === "layer") {
      const diagnostic = request.diagnostic;
      const derived = deriveLayerDiagnosticsFromLevels(
        profile.levels,
        diagnostic.lowerPressureHpa,
        diagnostic.upperPressureHpa,
        diagnostic.diagnostics,
      );
      return {
        model: MODEL,
        run: profile.run,
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        requestedPoint: profile.requestedPoint,
        gridPoint: profile.gridPoint,
        layer: derived.layer,
        levels: derived.levels,
        diagnostics: derived.diagnostics,
        source: profile.source,
      };
    }

    return {
      model: MODEL,
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      diagnostics: deriveProfileDiagnosticsFromLevels(
        profile.levels,
        request.diagnostic.diagnostics,
      ),
      source: profile.source,
    };
  }

  private async getDiagnosticTimeSeries(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("from" in request.time) || request.diagnostic.kind === "parcel") {
      throw new Error("Internal ICON-D2 routing error: expected supported diagnostic range");
    }
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", {
      type: "time_range",
      startTime,
      endTime,
      products: { pressure: true, surface: false },
    });
    const forecastHours = boundedForecastHours(
      run,
      startTime,
      endTime,
      request.time.maxSteps,
    );

    const results: any[] = [];
    for (const forecastHour of forecastHours) {
      results.push(await this.getInstantDiagnostic({
        ...request,
        time: { at: iconD2ValidTime(run, forecastHour).toISOString() },
        forecast: { ...request.forecast, run: run.toISOString() },
      } as DiagnoseAtmosphereRequest, run));
    }
    const first = results[0]!;
    return {
      model: MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: request.geometry.latitude, longitude: request.geometry.longitude },
      gridPoint: first.gridPoint,
      source: sourceWithoutCache(first.source),
      diagnostic: request.diagnostic,
      series: results.map((result) => request.diagnostic.kind === "layer"
        ? {
            kind: "layer",
            validTime: result.validTime,
            forecastHour: result.forecastHour,
            layer: result.layer,
            diagnostics: result.diagnostics,
            cacheHit: result.source.cacheHit,
          }
        : {
            kind: "profile",
            validTime: result.validTime,
            forecastHour: result.forecastHour,
            diagnostics: result.diagnostics,
            cacheHit: result.source.cacheHit,
          }),
    };
  }

  private async pointsAt(
    run: Date,
    validTime: Date,
    points: readonly PointCoordinate[],
    selection: ExpandedSelection,
  ): Promise<unknown> {
    const forecastHour = iconD2ForecastHour(run, validTime);
    const cached = await this.cache.fetch(dataRequest(run, forecastHour, selection));
    const profiles: IconD2ProfileResult[] = [];
    for (const point of points) {
      profiles.push(await this.decodeProfile(
        cached,
        run,
        validTime,
        point,
        selection,
      ));
    }
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      points: profiles.map((profile) => ({
        requestedPoint: profile.requestedPoint,
        gridPoint: profile.gridPoint,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
      })),
      source: {
        provider: "DWD Open Data" as const,
        access: "dwd_open_data" as const,
        decoder: this.decoder.engine ?? "gribberish",
        productGrid: iconD2ProductGrid(),
        cacheHit: cached.cacheHit,
      },
    };
  }

  private async profileAt(
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<IconD2ProfileResult> {
    const forecastHour = iconD2ForecastHour(run, validTime);
    const cached = await this.cache.fetch(dataRequest(run, forecastHour, selection));
    return this.decodeProfile(cached, run, validTime, point, selection);
  }

  private async decodeProfile(
    cached: IconD2SourceFile,
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<IconD2ProfileResult> {
    const decoded = await this.decoder.extractPoint(cached.path, point.longitude, point.latitude);
    const firstValue = decoded[0];
    if (firstValue === undefined) throw new Error("ICON-D2 decoder returned no grid point");

    assertPressureComplete(
      decoded,
      selection.variables.map((variable) => variable.gfsCode),
      selection.pressureLevelsHpa,
    );
    assertFieldsComplete(decoded, selection.fields);

    const levelMap = new Map<number, ProfileLevel>();
    for (const pressureHpa of selection.pressureLevelsHpa) {
      levelMap.set(pressureHpa, { pressureHpa });
    }
    for (const value of decoded) {
      if (value.pressureHpa === undefined) continue;
      const level = levelMap.get(value.pressureHpa);
      if (level !== undefined) applyDecodedPressureValue(level, value);
    }
    for (const level of levelMap.values()) {
      applyDerivedPressureValues(level, selection.variableIds);
    }
    const levels = [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa);
    const fields = selection.fieldIds.map((id) =>
      buildFieldResult(iconD2FieldDefinition(id), decoded, run));

    const gridPoint = firstValue.gridPoint;
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: iconD2ForecastHour(run, validTime),
      requestedPoint: { latitude: point.latitude, longitude: point.longitude },
      gridPoint,
      levels,
      ...(fields.length === 0 ? {} : { fields }),
      source: {
        provider: "DWD Open Data",
        access: "dwd_open_data",
        decoder: this.decoder.engine ?? "gribberish",
        productGrid: iconD2ProductGrid(),
        cacheHit: cached.cacheHit,
      },
    };
  }

  private resolveRun(
    selector: string,
    requirement: Parameters<typeof resolveIconD2Run>[1],
  ): Promise<Date> {
    return Promise.resolve(resolveIconD2Run(selector, requirement, this.runProvider));
  }
}

function expandedSelection(request: QueryAtmosphereRequest): ExpandedSelection {
  return expandSelection(
    (request.selection.variables ?? []) as VariableId[],
    request.selection.pressureLevelsHpa ?? [],
    (request.selection.fields ?? []) as NonIsobaricFieldId[],
  );
}

function expandSelection(
  variableIds: readonly VariableId[],
  pressureLevelsHpa: readonly number[],
  fieldIds: readonly NonIsobaricFieldId[],
): ExpandedSelection {
  return {
    variableIds: [...variableIds],
    variables: expandIconD2RequestedVariables(variableIds),
    pressureLevelsHpa: [...pressureLevelsHpa],
    fieldIds: [...fieldIds],
    fields: expandIconD2RequestedFields(fieldIds),
  };
}

function productsFor(selection: ExpandedSelection) {
  return {
    pressure: selection.variables.length > 0,
    surface: selection.fields.length > 0,
  };
}

function dataRequest(
  run: Date,
  forecastHour: number,
  selection: ExpandedSelection,
): IconD2DataRequest {
  return {
    run,
    forecastHour,
    variables: selection.variables,
    pressureLevelsHpa: selection.pressureLevelsHpa,
    fields: selection.fields,
  };
}

function boundedForecastHours(
  run: Date,
  startTime: Date,
  endTime: Date,
  requestedMaxSteps: number | undefined,
): number[] {
  const hours = iconD2NativeForecastHoursInRange(run, startTime, endTime);
  const maxSteps = requestedMaxSteps ?? MAX_NATIVE_STEPS;
  if (hours.length > maxSteps) {
    throw new Error(
      `Requested time range contains ${hours.length} native ICON-D2 outputs, exceeding maxSteps=${maxSteps}`,
    );
  }
  return hours;
}

function sourceWithoutCache(source: IconD2ProfileResult["source"]) {
  return {
    provider: source.provider,
    access: source.access,
    decoder: source.decoder,
    productGrid: source.productGrid,
  };
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

function estimateIconD2GridPoints(box: AreaBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / 0.02) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / 0.02) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizeGridPoints(
  points: readonly GridValuePoint[],
  normalize: (value: number) => number,
): GridValuePoint[] {
  return points.map((point) => ({ ...point, value: normalize(point.value) }));
}

function normalizePressureValue(variableId: string, value: number): number {
  return variableId === "temperature" ? value - 273.15 : value;
}

function normalizePressureStats(variableId: string, stats: GridStatistics): GridStatistics {
  return {
    ...stats,
    mean: normalizePressureValue(variableId, stats.mean),
    min: normalizePressureValue(variableId, stats.min),
    max: normalizePressureValue(variableId, stats.max),
  };
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

function areaSource(cacheHit: boolean, decoder: GribDecoderName | undefined) {
  return {
    provider: "DWD Open Data" as const,
    access: "dwd_open_data" as const,
    decoder: decoder ?? "gribberish",
    productGrid: iconD2ProductGrid(),
    cacheHit,
  };
}

const ICON_D2_RAW_VARIABLE_SET = new Set<string>(ICON_D2_RAW_PRESSURE_VARIABLE_IDS);

export function isIconD2RawAreaVariable(id: string): boolean {
  return ICON_D2_RAW_VARIABLE_SET.has(id)
    && VARIABLE_CATALOG[id as keyof typeof VARIABLE_CATALOG]?.kind === "raw";
}

export function isIconD2RawAreaField(id: string): boolean {
  return NON_ISOBARIC_FIELD_CATALOG[id as NonIsobaricFieldId]?.kind === "raw";
}

function iconD2ProductGrid() {
  return {
    type: "regular_latlon" as const,
    resolutionDegrees: 0.02 as const,
    interpolation: "dwd_open_data" as const,
  };
}
