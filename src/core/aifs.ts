import { homedir } from "node:os";
import { join } from "node:path";
import {
  AifsOpenDataSubsetCache,
  type AifsSelectionSource,
  type AifsSubsetFile,
} from "../cache/aifs-open-data-cache.js";
import {
  AIFS_AREA_FIELD_IDS,
  AIFS_FIELD_CATALOG,
  AIFS_PRESSURE_LEVELS_HPA,
  AIFS_PRESSURE_VARIABLE_IDS,
  AIFS_RAW_FIELD_IDS,
  AIFS_RAW_PRESSURE_VARIABLE_CATALOG,
  AIFS_RAW_PRESSURE_VARIABLE_IDS,
  expandAifsFields,
  expandAifsPressureVariables,
  isAifsAreaField,
  isAifsPressureLevel,
  isAifsPressureVariable,
  isAifsRawPressureVariable,
  isSupportedAifsPressureSelection,
  type AifsFieldId,
  type AifsPressureVariableId,
  type AifsRawFieldId,
  type AifsRawPressureVariableId,
} from "../catalog/aifs.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricLevel,
} from "../catalog/non-isobaric-fields.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  deriveAirDensityKgM3,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveSaturationVaporPressureHpa,
  deriveSpecificHumidityFromRelativeHumidityKgKg,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import {
  decodePointMessages,
  gridPointsInBox,
  readGribMessages,
  type GribBox,
  type GribGridPoint,
} from "../grib/gribberish-runtime.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type { PointCoordinate, VariableId } from "../schema/query.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import { computeAreaDistribution } from "./area-distribution.js";
import {
  AifsLatestRunResolver,
  type AifsLatestRunProvider,
} from "./aifs-run.js";
import {
  aifsForecastHour,
  aifsForecastHoursInRange,
  aifsValidTime,
  parseAifsRun,
} from "./aifs-time.js";
import { deriveLayerDiagnosticsFromLevels, deriveProfileDiagnosticsFromLevels } from "./pressure-diagnostics.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";
import type { DecodedValue, GribDecoderName } from "../types/decoded.js";
import type { NonIsobaricFieldResult, ProfileLevel } from "./types.js";
import { InvalidRequestError } from "../failure.js";

const MODEL = "aifs_0p25" as const;
const MAX_NATIVE_STEPS = 61;
const HOUR_MS = 3_600_000;
const STANDARD_GRAVITY = 9.80665;

type SelectionItem =
  | {
      kind: "pressure";
      rawId: AifsRawPressureVariableId;
      pressureHpa: number;
      selector: IfsIndexSelector;
    }
  | {
      kind: "field";
      rawId: AifsRawFieldId;
      selector: IfsIndexSelector;
    };

interface ExpandedSelection {
  variableIds: AifsPressureVariableId[];
  pressureLevelsHpa: number[];
  fieldIds: AifsFieldId[];
  items: SelectionItem[];
}

interface AifsProfileResult {
  model: typeof MODEL;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: PointCoordinate;
  gridPoint: PointCoordinate;
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
  source: {
    provider: "ECMWF Open Data";
    access: "indexed_http_range";
    decoder: GribDecoderName;
    product: "aifs_single_0p25_oper_fc";
    horizontalGridDegrees: 0.25;
    cacheHit: boolean;
  };
}

export interface AifsPointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface AifsForecastServiceOptions {
  cacheDir?: string;
  source?: AifsSelectionSource;
  decoder?: AifsPointDecoder;
  latestRunProvider?: AifsLatestRunProvider;
}

export class AifsForecastService {
  private readonly source: AifsSelectionSource;
  private readonly decoder: AifsPointDecoder;
  private readonly latestRunProvider: AifsLatestRunProvider;

  constructor(options: AifsForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new AifsOpenDataSubsetCache(join(cacheDir, "aifs-open-data"));
    this.decoder = options.decoder ?? new BundledAifsPointDecoder();
    this.latestRunProvider = options.latestRunProvider ?? new AifsLatestRunResolver({ cacheDir });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aifs") throw new Error("AIFS service only accepts dataset=aifs");
    if (request.geometry.type === "point") {
      return "at" in request.time ? this.getPoint(request) : this.getTimeSeries(request);
    }
    if (request.geometry.type === "points") {
      return "at" in request.time ? this.getPoints(request) : this.getPointsTimeSeries(request);
    }
    if (request.geometry.type === "transect") return this.getTransect(request);
    return this.getAreaSummary(request);
  }

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aifs") throw new Error("AIFS service only accepts dataset=aifs");
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "AIFS parcel diagnostics are not exposed in this first slice; layer and structural profile diagnostics are supported",
      );
    }
    return "at" in request.time
      ? this.getInstantDiagnostic(request)
      : this.getDiagnosticTimeSeries(request);
  }

  private async getPoint(request: QueryAtmosphereRequest): Promise<AifsProfileResult> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal AIFS routing error: expected point instant query");
    }
    const selection = prepareSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", validTime, selection);
    return this.profileAt(run, validTime, request.geometry, selection);
  }

  private async getTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal AIFS routing error: expected point time range");
    }
    const selection = prepareSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRangeRun(
      request.forecast?.run ?? "latest",
      startTime,
      endTime,
      selection,
    );
    const forecastHours = boundedForecastHours(run, startTime, endTime, request.time.maxSteps);
    const profiles: AifsProfileResult[] = [];
    for (const forecastHour of forecastHours) {
      profiles.push(await this.profileAt(
        run,
        aifsValidTime(run, forecastHour),
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
      source: sourceWithoutCache(first.source),
      series: profiles.map((profile) => ({
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        gridPoint: profile.gridPoint,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
        cacheHit: profile.source.cacheHit,
      })),
    };
  }

  private async getPoints(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal AIFS routing error: expected points instant query");
    }
    const selection = prepareSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", validTime, selection);
    return this.pointsAt(run, validTime, request.geometry.points, selection);
  }

  private async getPointsTimeSeries(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal AIFS routing error: expected points time range");
    }
    const selection = prepareSelection(request);
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const run = await this.resolveRangeRun(
      request.forecast?.run ?? "latest",
      startTime,
      endTime,
      selection,
    );
    const forecastHours = boundedForecastHours(run, startTime, endTime, request.time.maxSteps);
    const pointSteps = request.geometry.points.length * forecastHours.length;
    const maxPointSteps = request.limits?.maxPointSteps ?? request.limits?.maxSamples ?? 5_000;
    if (pointSteps > maxPointSteps) {
      throw new InvalidRequestError(
        `Requested AIFS matrix contains ${request.geometry.points.length} points × ${forecastHours.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${maxPointSteps}`,
      );
    }

    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        aifsValidTime(run, forecastHour),
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
      throw new Error("Internal AIFS routing error: expected transect instant query");
    }
    const selection = prepareSelection(request);
    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", validTime, selection);
    const samples = request.geometry.samples ?? 21;
    const points = interpolateGreatCircle(request.geometry.start, request.geometry.end, samples);
    const batch: any = await this.pointsAt(run, validTime, points, selection);
    const totalDistanceKm = greatCircleDistanceKm(request.geometry.start, request.geometry.end);
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: aifsForecastHour(run, validTime),
      startPoint: { ...request.geometry.start },
      endPoint: { ...request.geometry.end },
      totalDistanceKm,
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
      throw new Error("Internal AIFS routing error: expected area instant query");
    }
    const selection = prepareSelection(request);
    if (
      !(
        selection.variableIds.length === 1
        && selection.pressureLevelsHpa.length === 1
        && selection.fieldIds.length === 0
        && isAifsRawPressureVariable(selection.variableIds[0]!)
      )
      && !(
        selection.variableIds.length === 0
        && selection.pressureLevelsHpa.length === 0
        && selection.fieldIds.length === 1
        && isAifsAreaField(selection.fieldIds[0]!)
      )
    ) {
      throw new Error("AIFS area queries require one raw pressure variable at one level or one raw field");
    }

    const box: GribBox = {
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
    };
    const estimatedGridPoints = estimateAifsGridPoints(box);
    const maxGridPoints = request.limits?.maxGridPoints ?? 1_100_000;
    if (estimatedGridPoints > maxGridPoints) {
      throw new InvalidRequestError(
        `Requested bbox is approximately ${estimatedGridPoints} AIFS grid points, exceeding maxGridPoints=${maxGridPoints}`,
      );
    }

    const validTime = new Date(request.time.at);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", validTime, selection);
    const forecastHour = aifsForecastHour(run, validTime);
    const cached = await this.source.fetchSelection({
      run,
      forecastHour,
      selectors: selection.items.map((item) => item.selector),
    });
    const messages = await readGribMessages(cached.path);
    if (messages.length !== 1) {
      throw new Error(`AIFS area decoder expected one selected GRIB message, found ${messages.length}`);
    }
    const rawPoints = gridPointsInBox(messages[0]!, box);
    const normalized = selection.variableIds.length === 1
      ? rawPoints.map((point) => ({
          ...point,
          value: normalizePressureValue(selection.variableIds[0]!, point.value),
        }))
      : rawPoints.map((point) => ({
          ...point,
          value: normalizeFieldValue(selection.fieldIds[0]! as AifsRawFieldId, point.value),
        }));
    const computed = computeAreaDistribution(normalized, distributionOptions(request));

    if (selection.variableIds.length === 1) {
      const variableId = selection.variableIds[0]!;
      const output = VARIABLE_CATALOG[variableId].outputs[0]!;
      return {
        model: MODEL,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        bbox: box,
        variable: {
          id: variableId,
          pressureHpa: selection.pressureLevelsHpa[0]!,
          field: output.field,
          unit: output.unit,
        },
        statistics: publicStatistics(computed.statistics),
        ...(wantsDistribution(request) ? { distribution: computed.distribution } : {}),
        source: areaSource(cached.cacheHit),
      };
    }

    const fieldId = selection.fieldIds[0]! as AifsRawFieldId;
    const definition = AIFS_FIELD_CATALOG[fieldId];
    const canonical = NON_ISOBARIC_FIELD_CATALOG[fieldId];
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      bbox: box,
      field: {
        id: fieldId,
        level: publicLevel(canonical.level),
        temporal: definition.temporalSemantics === "accumulation"
          ? accumulationTemporal(run, forecastHour)
          : { type: "instantaneous" },
        output: { ...canonical.outputs[0]! },
      },
      statistics: publicStatistics(computed.statistics),
      ...(wantsDistribution(request) ? { distribution: computed.distribution } : {}),
      source: areaSource(cached.cacheHit),
    };
  }

  private async getInstantDiagnostic(
    request: DiagnoseAtmosphereRequest,
    explicitRun?: Date,
  ): Promise<unknown> {
    if (!("at" in request.time) || request.diagnostic.kind === "parcel") {
      throw new Error("Internal AIFS routing error: expected supported instant diagnostic");
    }
    const validTime = new Date(request.time.at);
    const pressureLevelsHpa = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const requested = request.diagnostic.kind === "layer"
      ? expandLayerDiagnosticVariables(request.diagnostic.diagnostics)
      : expandProfileDiagnosticVariables(request.diagnostic.diagnostics);
    const selection = selectionFrom(requested, pressureLevelsHpa, []);
    const run = explicitRun
      ?? await this.resolveRun(request.forecast?.run ?? "latest", validTime, selection);
    const profile = await this.profileAt(run, validTime, request.geometry, selection);

    if (request.diagnostic.kind === "layer") {
      const derived = deriveLayerDiagnosticsFromLevels(
        profile.levels,
        request.diagnostic.lowerPressureHpa,
        request.diagnostic.upperPressureHpa,
        request.diagnostic.diagnostics,
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
      throw new Error("Internal AIFS routing error: expected supported diagnostic range");
    }
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const pressureLevelsHpa = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const requested = request.diagnostic.kind === "layer"
      ? expandLayerDiagnosticVariables(request.diagnostic.diagnostics)
      : expandProfileDiagnosticVariables(request.diagnostic.diagnostics);
    const selection = selectionFrom(requested, pressureLevelsHpa, []);
    const run = await this.resolveRangeRun(
      request.forecast?.run ?? "latest",
      startTime,
      endTime,
      selection,
    );
    const forecastHours = boundedForecastHours(run, startTime, endTime, request.time.maxSteps);
    const results: any[] = [];
    for (const forecastHour of forecastHours) {
      results.push(await this.getInstantDiagnostic({
        ...request,
        time: { at: aifsValidTime(run, forecastHour).toISOString() },
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
    const forecastHour = aifsForecastHour(run, validTime);
    const cached = await this.fetchSelection(run, forecastHour, selection);
    const profiles: AifsProfileResult[] = [];
    for (const point of points) {
      profiles.push(await this.decodeProfile(cached, run, validTime, point, selection));
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
        provider: "ECMWF Open Data" as const,
        access: "indexed_http_range" as const,
        decoder: this.decoder.engine ?? "gribberish",
        product: "aifs_single_0p25_oper_fc" as const,
        horizontalGridDegrees: 0.25 as const,
        cacheHit: cached.cacheHit,
      },
    };
  }

  private async profileAt(
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<AifsProfileResult> {
    const forecastHour = aifsForecastHour(run, validTime);
    const cached = await this.fetchSelection(run, forecastHour, selection);
    return this.decodeProfile(cached, run, validTime, point, selection);
  }

  private fetchSelection(
    run: Date,
    forecastHour: number,
    selection: ExpandedSelection,
  ): Promise<AifsSubsetFile> {
    return this.source.fetchSelection({
      run,
      forecastHour,
      selectors: selection.items.map((item) => item.selector),
    });
  }

  private async decodeProfile(
    cached: AifsSubsetFile,
    run: Date,
    validTime: Date,
    point: PointCoordinate,
    selection: ExpandedSelection,
  ): Promise<AifsProfileResult> {
    const decoded = await this.decoder.extractPoint(cached.path, point.longitude, point.latitude);
    if (decoded.length !== selection.items.length) {
      throw new Error(
        `AIFS decoder returned ${decoded.length} values for ${selection.items.length} selected GRIB messages`,
      );
    }
    const first = decoded[0];
    if (!first) throw new Error("AIFS decoder returned no values");
    assertGridConsistency(decoded);

    const levelMap = new Map<number, ProfileLevel>();
    for (const pressureHpa of selection.pressureLevelsHpa) {
      levelMap.set(pressureHpa, { pressureHpa });
    }
    const fieldValues = new Map<AifsRawFieldId, number>();

    selection.items.forEach((item, index) => {
      const sample = decoded[index]!;
      if (item.kind === "pressure") {
        const level = levelMap.get(item.pressureHpa);
        if (!level) throw new Error(`Internal AIFS pressure selection mismatch at ${item.pressureHpa} hPa`);
        applyRawPressureValue(level, item.rawId, sample.value);
      } else {
        fieldValues.set(item.rawId, sample.value);
      }
    });

    for (const level of levelMap.values()) {
      applyDerivedPressureValues(level, selection.variableIds);
    }
    const fields = selection.fieldIds.map((id) =>
      buildFieldResult(id, fieldValues, run, validTime, aifsForecastHour(run, validTime)));

    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: aifsForecastHour(run, validTime),
      requestedPoint: { latitude: point.latitude, longitude: point.longitude },
      gridPoint: first.gridPoint,
      levels: [...levelMap.values()].sort((left, right) => right.pressureHpa - left.pressureHpa),
      ...(fields.length === 0 ? {} : { fields }),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: this.decoder.engine ?? "gribberish",
        product: "aifs_single_0p25_oper_fc",
        horizontalGridDegrees: 0.25,
        cacheHit: cached.cacheHit,
      },
    };
  }

  private resolveRun(
    selector: string,
    validTime: Date,
    selection: ExpandedSelection,
  ): Promise<Date> {
    if (selector === "latest") {
      return this.latestRunProvider.resolveLatestRun(
        validTime,
        selection.items.map((item) => item.selector),
      );
    }
    if (selector === "latest_complete") {
      throw new Error("AIFS does not expose latest_complete; use latest or an explicit initialization");
    }
    return Promise.resolve(parseAifsRun(selector));
  }

  private resolveRangeRun(
    selector: string,
    startTime: Date,
    endTime: Date,
    selection: ExpandedSelection,
  ): Promise<Date> {
    if (selector === "latest") {
      return this.latestRunProvider.resolveLatestRunForRange(
        startTime,
        endTime,
        selection.items.map((item) => item.selector),
      );
    }
    if (selector === "latest_complete") {
      throw new Error("AIFS does not expose latest_complete; use latest or an explicit initialization");
    }
    return Promise.resolve(parseAifsRun(selector));
  }
}

class BundledAifsPointDecoder implements AifsPointDecoder {
  readonly engine = "gribberish" as const;

  async extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]> {
    return decodePointMessages(await readGribMessages(path), longitude, latitude);
  }
}

function prepareSelection(request: QueryAtmosphereRequest): ExpandedSelection {
  return selectionFrom(
    request.selection.variables ?? [],
    request.selection.pressureLevelsHpa ?? [],
    request.selection.fields ?? [],
  );
}

function selectionFrom(
  variableIds: readonly string[],
  pressureLevelsHpa: readonly number[],
  fieldIds: readonly string[],
): ExpandedSelection {
  const unsupportedVariables = variableIds.filter((id) => !isAifsPressureVariable(id));
  if (unsupportedVariables.length > 0) {
    throw new Error(`AIFS pressure variables not supported: ${unsupportedVariables.join(", ")}`);
  }
  const unsupportedLevels = pressureLevelsHpa.filter((level) => !isAifsPressureLevel(level));
  if (unsupportedLevels.length > 0) {
    throw new Error(`AIFS pressure levels not supported: ${unsupportedLevels.join(", ")}`);
  }
  const unsupportedSelections = typedPressureSelections(
    variableIds as AifsPressureVariableId[],
    pressureLevelsHpa,
  ).filter(({ id, pressureHpa }) => !isSupportedAifsPressureSelection(id, pressureHpa));
  if (unsupportedSelections.length > 0) {
    throw new Error(
      `AIFS pressure variable/level selections not supported: ${unsupportedSelections
        .map(({ id, pressureHpa }) => `${id}@${pressureHpa}hPa`)
        .join(", ")}`,
    );
  }
  const supportedFieldSet = new Set<string>([...AIFS_RAW_FIELD_IDS, "relative_humidity_2m", "specific_humidity_2m", "wind_10m", "wind_100m"]);
  const unsupportedFields = fieldIds.filter((id) => !supportedFieldSet.has(id));
  if (unsupportedFields.length > 0) {
    throw new Error(`AIFS fields not supported: ${unsupportedFields.join(", ")}`);
  }

  const typedVariables = variableIds as AifsPressureVariableId[];
  const typedFields = fieldIds as AifsFieldId[];
  const items: SelectionItem[] = [];
  for (const rawId of expandAifsPressureVariables(typedVariables)) {
    const definition = AIFS_RAW_PRESSURE_VARIABLE_CATALOG[rawId];
    for (const pressureHpa of pressureLevelsHpa) {
      items.push({
        kind: "pressure",
        rawId,
        pressureHpa,
        selector: {
          key: `${rawId}@${pressureHpa}`,
          param: definition.param,
          levtype: "pl",
          levelist: pressureHpa,
        },
      });
    }
  }
  for (const rawId of expandAifsFields(typedFields)) {
    const definition = AIFS_FIELD_CATALOG[rawId];
    if (definition.kind !== "raw") throw new Error(`Internal AIFS field expansion error for ${rawId}`);
    items.push({
      kind: "field",
      rawId,
      selector: { key: rawId, param: definition.param, levtype: "sfc" },
    });
  }
  return {
    variableIds: [...typedVariables],
    pressureLevelsHpa: [...pressureLevelsHpa],
    fieldIds: [...typedFields],
    items,
  };
}

function typedPressureSelections(
  variableIds: readonly AifsPressureVariableId[],
  pressureLevelsHpa: readonly number[],
): Array<{ id: AifsPressureVariableId; pressureHpa: number }> {
  return variableIds.flatMap((id) =>
    pressureLevelsHpa.map((pressureHpa) => ({ id, pressureHpa })));
}

function applyRawPressureValue(
  level: ProfileLevel,
  id: AifsRawPressureVariableId,
  value: number,
): void {
  switch (id) {
    case "temperature": level.temperatureC = value - 273.15; break;
    case "u_wind": level.uWindMs = value; break;
    case "v_wind": level.vWindMs = value; break;
    case "geopotential_height": level.geopotentialHeightGpm = value / STANDARD_GRAVITY; break;
    case "specific_humidity": level.specificHumidityKgKg = value; break;
    case "vertical_velocity": level.verticalVelocityPaS = value; break;
  }
}

function applyDerivedPressureValues(
  level: ProfileLevel,
  requestedIds: readonly AifsPressureVariableId[],
): void {
  const requested = new Set<string>(requestedIds);
  if (requested.has("wind")) {
    const wind = deriveWind(
      dependency(level.uWindMs, "u_wind", level.pressureHpa),
      dependency(level.vWindMs, "v_wind", level.pressureHpa),
    );
    level.windSpeedMs = wind.speedMs;
    level.windDirectionDeg = wind.directionDeg;
  }
  if (requested.has("potential_temperature")) {
    level.potentialTemperatureK = derivePotentialTemperatureK(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      level.pressureHpa,
    );
  }
  if (requested.has("mixing_ratio")) {
    level.mixingRatioKgKg = deriveMixingRatioKgKg(
      dependency(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
    );
  }
  if (requested.has("virtual_temperature")) {
    level.virtualTemperatureC = deriveVirtualTemperatureC(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      dependency(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
    );
  }
  if (requested.has("air_density")) {
    level.airDensityKgM3 = deriveAirDensityKgM3(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      dependency(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
      level.pressureHpa,
    );
  }
  if (requested.has("wet_bulb_temperature")) {
    level.wetBulbTemperatureC = deriveWetBulbTemperatureC(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      dependency(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
      level.pressureHpa,
    );
  }
  if (requested.has("equivalent_potential_temperature")) {
    level.equivalentPotentialTemperatureK = deriveEquivalentPotentialTemperatureK(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      dependency(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
      level.pressureHpa,
    );
  }
}

function buildFieldResult(
  id: AifsFieldId,
  rawValues: ReadonlyMap<AifsRawFieldId, number>,
  run: Date,
  validTime: Date,
  forecastHour: number,
): NonIsobaricFieldResult {
  const source = AIFS_FIELD_CATALOG[id];
  const canonical = NON_ISOBARIC_FIELD_CATALOG[id];

  if (source.kind === "raw") {
    const rawValue = rawValues.get(source.id);
    if (rawValue === undefined) throw new Error(`Internal AIFS field value missing: ${source.id}`);
    const output = canonical.outputs[0]!;
    return {
      id,
      level: publicLevel(canonical.level),
      temporal: source.temporalSemantics === "accumulation"
        ? accumulationTemporal(run, forecastHour)
        : { type: "instantaneous" },
      values: { [output.field]: normalizeFieldValue(source.id, rawValue) },
    };
  }

  if (id === "wind_10m" || id === "wind_100m") {
    const u = rawValues.get(source.dependencies[0]!);
    const v = rawValues.get(source.dependencies[1]!);
    if (u === undefined || v === undefined) throw new Error(`Internal AIFS wind dependency missing for ${id}`);
    const wind = deriveWind(u, v);
    return {
      id,
      level: publicLevel(canonical.level),
      temporal: { type: "instantaneous" },
      values: { windSpeedMs: wind.speedMs, windDirectionDeg: wind.directionDeg },
    };
  }

  const temperatureK = rawValues.get("temperature_2m");
  const dewPointK = rawValues.get("dew_point_2m");
  if (temperatureK === undefined || dewPointK === undefined) {
    throw new Error(`Internal AIFS 2 m humidity dependency missing for ${id}`);
  }
  const temperatureC = temperatureK - 273.15;
  const dewPointC = dewPointK - 273.15;
  const relativeHumidityPct = relativeHumidityFromDewPointPct(temperatureC, dewPointC);

  if (id === "relative_humidity_2m") {
    return {
      id,
      level: publicLevel(canonical.level),
      temporal: { type: "instantaneous" },
      values: { relativeHumidityPct },
    };
  }

  const surfacePressurePa = rawValues.get("surface_pressure");
  if (surfacePressurePa === undefined) {
    throw new Error("Internal AIFS surface-pressure dependency missing for specific_humidity_2m");
  }
  return {
    id,
    level: publicLevel(canonical.level),
    temporal: { type: "instantaneous" },
    values: {
      specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
        temperatureC,
        relativeHumidityPct,
        surfacePressurePa / 100,
      ),
    },
  };
}

function normalizePressureValue(id: AifsPressureVariableId, value: number): number {
  if (id === "temperature") return value - 273.15;
  if (id === "geopotential_height") return value / STANDARD_GRAVITY;
  return value;
}

function normalizeFieldValue(id: AifsRawFieldId, value: number): number {
  const definition = AIFS_FIELD_CATALOG[id];
  if (definition.kind !== "raw") throw new Error(`Internal AIFS raw field normalization error: ${id}`);
  const output = NON_ISOBARIC_FIELD_CATALOG[id].outputs[0]!;
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  if (definition.sourceUnit === "m" && output.unit === "mm") return value * 1_000;
  if (definition.sourceUnit === "fraction" && output.unit === "%") return value * 100;
  if (id === "surface_geopotential_height") return value / STANDARD_GRAVITY;
  return value;
}

function relativeHumidityFromDewPointPct(temperatureC: number, dewPointC: number): number {
  const saturation = deriveSaturationVaporPressureHpa(temperatureC);
  const vapor = deriveSaturationVaporPressureHpa(dewPointC);
  return Math.max(0, Math.min(100, 100 * vapor / saturation));
}

function accumulationTemporal(run: Date, forecastHour: number) {
  return {
    type: "accumulation" as const,
    startForecastHour: 0,
    endForecastHour: forecastHour,
    startTime: run.toISOString(),
    endTime: new Date(run.getTime() + forecastHour * HOUR_MS).toISOString(),
  };
}

function publicLevel(level: NonIsobaricLevel): NonIsobaricFieldResult["level"] {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m": return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function boundedForecastHours(
  run: Date,
  startTime: Date,
  endTime: Date,
  requestedMaxSteps: number | undefined,
): number[] {
  const hours = aifsForecastHoursInRange(run, startTime, endTime);
  const maxSteps = requestedMaxSteps ?? MAX_NATIVE_STEPS;
  if (hours.length > maxSteps) {
    throw new InvalidRequestError(
      `Requested time range contains ${hours.length} native AIFS outputs, exceeding maxSteps=${maxSteps}`,
    );
  }
  return hours;
}

function estimateAifsGridPoints(box: GribBox): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / 0.25) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / 0.25) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
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

function publicStatistics(
  stats: { definedGridPoints: number; mean: number; min: number; max: number },
) {
  return {
    definedGridPoints: stats.definedGridPoints,
    mean: stats.mean,
    min: stats.min,
    max: stats.max,
    meanKind: "unweighted_grid_point_mean" as const,
  };
}

function sourceWithoutCache(source: AifsProfileResult["source"]) {
  const { cacheHit: _cacheHit, ...rest } = source;
  return rest;
}

function areaSource(cacheHit: boolean) {
  return {
    provider: "ECMWF Open Data" as const,
    access: "indexed_http_range" as const,
    decoder: "gribberish" as const,
    product: "aifs_single_0p25_oper_fc" as const,
    horizontalGridDegrees: 0.25 as const,
    cacheHit,
  };
}

function dependency(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) {
    throw new Error(`AIFS derived-variable dependency missing: ${id}@${pressureHpa}hPa`);
  }
  return value;
}

function assertGridConsistency(values: readonly DecodedValue[]): void {
  const first = values[0];
  if (!first) return;
  for (const value of values.slice(1)) {
    if (
      value.gridPoint.latitude !== first.gridPoint.latitude
      || value.gridPoint.longitude !== first.gridPoint.longitude
    ) {
      throw new Error("AIFS selected fields resolved to inconsistent grid points");
    }
  }
}

export const AIFS_SUPPORTED_PRESSURE_LEVELS_HPA = AIFS_PRESSURE_LEVELS_HPA;
export const AIFS_SUPPORTED_PRESSURE_VARIABLE_IDS = AIFS_PRESSURE_VARIABLE_IDS;
export const AIFS_SUPPORTED_AREA_FIELD_IDS = AIFS_AREA_FIELD_IDS;
export const AIFS_SUPPORTED_RAW_PRESSURE_VARIABLE_IDS = AIFS_RAW_PRESSURE_VARIABLE_IDS;
