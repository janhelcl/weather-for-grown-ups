import { homedir } from "node:os";
import { join } from "node:path";
import {
  IfsOpenDataSubsetCache,
  type IfsSelectionSource,
} from "../cache/ifs-open-data-cache.js";
import {
  IFS_FIELD_CATALOG,
  IFS_RAW_PRESSURE_VARIABLE_CATALOG,
  expandIfsFields,
  expandIfsPressureVariables,
  type IfsFieldId,
  type IfsPressureVariableId,
  type IfsRawFieldId,
  type IfsRawPressureVariableId,
} from "../catalog/ifs.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricLevel,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveSaturationVaporPressureHpa,
  deriveSpecificHumidityFromRelativeHumidityKgKg,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import { decodePointMessages, readGribMessages } from "../grib/gribberish-runtime.js";
import {
  ifsPointQuerySchema,
  ifsProfileResultSchema,
  type IfsPointQueryInput,
  type IfsProfileResult,
} from "../schema/ifs.js";
import type {
  DecodedValue,
  GribDecoderName,
  NonIsobaricFieldResult,
  ProfileLevel,
} from "./types.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import { IfsLatestRunResolver, type IfsLatestRunProvider } from "./ifs-latest-run.js";
import { ifsForecastHour, parseIfsRun } from "./ifs-time.js";

export interface IfsPointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface IfsProfileServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  decoder?: IfsPointDecoder;
  latestRunProvider?: IfsLatestRunProvider;
}

type IfsSelectionItem =
  | {
      kind: "pressure";
      rawId: IfsRawPressureVariableId;
      pressureHpa: number;
      selector: IfsIndexSelector;
    }
  | {
      kind: "field";
      rawId: IfsRawFieldId;
      selector: IfsIndexSelector;
    };

export class IfsProfileService {
  private readonly source: IfsSelectionSource;
  private readonly decoder: IfsPointDecoder;
  private readonly latestRunProvider: IfsLatestRunProvider;

  constructor(options: IfsProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.decoder = options.decoder ?? new BundledIfsPointDecoder();
    this.latestRunProvider = options.latestRunProvider ?? new IfsLatestRunResolver();
  }

  async getProfile(input: IfsPointQueryInput): Promise<IfsProfileResult> {
    const query = ifsPointQuerySchema.parse(input);
    const selection = prepareSelection(query);
    const validTime = new Date(query.validTime);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(
          validTime,
          selection.map((item) => item.selector),
        )
      : parseIfsRun(query.run);
    const forecastHour = ifsForecastHour(run, validTime);

    const decodedSelection: Array<{ item: IfsSelectionItem; sample: DecodedValue }> = [];
    let allCacheHit = true;
    for (const [sourceForecastHour, items] of groupSelectionByForecastHour(selection, forecastHour)) {
      const cached = await this.source.fetchSelection({
        run,
        forecastHour: sourceForecastHour,
        selectors: items.map((item) => item.selector),
      });
      const decoded = await this.decoder.extractPoint(cached.path, query.longitude, query.latitude);
      if (decoded.length !== items.length) {
        throw new Error(
          `IFS decoder returned ${decoded.length} values for ${items.length} selected GRIB messages at f${sourceForecastHour}`,
        );
      }
      allCacheHit = allCacheHit && cached.cacheHit;
      items.forEach((item, index) => {
        decodedSelection.push({ item, sample: decoded[index]! });
      });
    }
    const decoded = decodedSelection.map(({ sample }) => sample);
    const first = decoded[0];
    if (!first) throw new Error("IFS decoder returned no values");
    assertGridConsistency(decoded);

    const levelMap = new Map<number, ProfileLevel>();
    for (const pressureHpa of query.pressureLevelsHpa ?? []) {
      levelMap.set(pressureHpa, { pressureHpa });
    }
    const fieldValues = new Map<IfsRawFieldId, number>();

    for (const { item, sample } of decodedSelection) {
      if (item.kind === "pressure") {
        const level = levelMap.get(item.pressureHpa);
        if (!level) throw new Error(`Internal IFS pressure selection mismatch at ${item.pressureHpa} hPa`);
        applyRawPressureValue(level, item.rawId, sample.value, query.latitude);
      } else {
        fieldValues.set(item.rawId, sample.value);
      }
    }

    for (const level of levelMap.values()) {
      applyDerivedPressureValues(level, query.variables ?? []);
    }

    const fields = (query.fields ?? []).map((id) =>
      buildFieldResult(id, fieldValues, run, validTime, forecastHour),
    );

    return ifsProfileResultSchema.parse({
      model: "ifs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      levels: [...levelMap.values()].sort((left, right) => right.pressureHpa - left.pressureHpa),
      ...(fields.length === 0 ? {} : { fields }),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: this.decoder.engine ?? "gribberish",
        product: "ifs_0p25_oper_fc",
        horizontalGridDegrees: 0.25,
        cacheHit: allCacheHit,
      },
    });
  }
}

export function ifsIndexSelectorsForSelection(selection: {
  variables?: readonly IfsPressureVariableId[] | undefined;
  pressureLevelsHpa?: readonly number[] | undefined;
  fields?: readonly IfsFieldId[] | undefined;
}): IfsIndexSelector[] {
  return prepareSelection({
    variables: selection.variables === undefined ? undefined : [...selection.variables],
    pressureLevelsHpa: selection.pressureLevelsHpa === undefined ? undefined : [...selection.pressureLevelsHpa],
    fields: selection.fields === undefined ? undefined : [...selection.fields],
  } as ReturnType<typeof ifsPointQuerySchema.parse>).map((item) => item.selector);
}

class BundledIfsPointDecoder implements IfsPointDecoder {
  readonly engine = "gribberish" as const;

  async extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]> {
    return decodePointMessages(await readGribMessages(path), longitude, latitude);
  }
}

function prepareSelection(query: ReturnType<typeof ifsPointQuerySchema.parse>): IfsSelectionItem[] {
  const items: IfsSelectionItem[] = [];
  for (const rawId of expandIfsPressureVariables(query.variables ?? [])) {
    const definition = IFS_RAW_PRESSURE_VARIABLE_CATALOG[rawId];
    for (const pressureHpa of query.pressureLevelsHpa ?? []) {
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
  for (const rawId of expandIfsFields(query.fields ?? [])) {
    const definition = IFS_FIELD_CATALOG[rawId];
    if (definition.kind !== "raw") throw new Error(`Internal IFS field expansion error for ${rawId}`);
    items.push({
      kind: "field",
      rawId,
      selector: {
        key: rawId,
        param: definition.param,
        levtype: definition.levtype,
        ...(definition.sourceForecastHour === undefined
          ? {}
          : { sourceForecastHour: definition.sourceForecastHour }),
      },
    });
  }
  return items;
}

function groupSelectionByForecastHour(
  selection: readonly IfsSelectionItem[],
  requestedForecastHour: number,
): Map<number, IfsSelectionItem[]> {
  const groups = new Map<number, IfsSelectionItem[]>();
  for (const item of selection) {
    const sourceForecastHour = item.selector.sourceForecastHour ?? requestedForecastHour;
    const group = groups.get(sourceForecastHour) ?? [];
    group.push(item);
    groups.set(sourceForecastHour, group);
  }
  return groups;
}

function applyRawPressureValue(
  level: ProfileLevel,
  id: IfsRawPressureVariableId,
  value: number,
  latitudeDeg: number,
): void {
  switch (id) {
    case "temperature": level.temperatureC = value - 273.15; break;
    case "relative_humidity": level.relativeHumidityPct = value; break;
    case "u_wind": level.uWindMs = value; break;
    case "v_wind": level.vWindMs = value; break;
    case "geopotential_height": level.geopotentialHeightGpm = value; break;
    case "specific_humidity": level.specificHumidityKgKg = value; break;
    case "vertical_velocity": level.verticalVelocityPaS = value; break;
    case "relative_vorticity":
      level.absoluteVorticityS1 = value + coriolisParameterS1(latitudeDeg);
      break;
    case "divergence": level.divergenceS1 = value; break;
  }
}

function applyDerivedPressureValues(level: ProfileLevel, requestedIds: readonly string[]): void {
  const requested = new Set(requestedIds);
  if (requested.has("wind")) {
    const wind = deriveWind(
      dependency(level.uWindMs, "u_wind", level.pressureHpa),
      dependency(level.vWindMs, "v_wind", level.pressureHpa),
    );
    level.windSpeedMs = wind.speedMs;
    level.windDirectionDeg = wind.directionDeg;
  }
  if (requested.has("dew_point")) {
    level.dewPointC = deriveDewPointC(
      dependency(level.temperatureC, "temperature", level.pressureHpa),
      dependency(level.relativeHumidityPct, "relative_humidity", level.pressureHpa),
    );
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
  id: IfsFieldId,
  rawValues: ReadonlyMap<IfsRawFieldId, number>,
  run: Date,
  validTime: Date,
  forecastHour: number,
): NonIsobaricFieldResult {
  const source = IFS_FIELD_CATALOG[id];
  const canonical = NON_ISOBARIC_FIELD_CATALOG[id];

  if (source.kind === "raw") {
    const rawValue = rawValues.get(source.id);
    if (rawValue === undefined) throw new Error(`Internal IFS field value missing: ${source.id}`);
    const output = canonical.outputs[0];
    if (!output) throw new Error(`IFS canonical field ${id} has no output definition`);
    return {
      id,
      level: publicLevel(canonical.level),
      temporal: source.temporalSemantics === "accumulation"
        ? {
            type: "accumulation",
            startForecastHour: 0,
            endForecastHour: forecastHour,
            startTime: run.toISOString(),
            endTime: validTime.toISOString(),
          }
        : { type: "instantaneous" },
      values: {
        [output.field]: normalizeFieldValue(source.id, rawValue),
      },
    };
  }

  if (id === "wind_10m" || id === "wind_100m") {
    const u = rawValues.get(source.dependencies[0]!);
    const v = rawValues.get(source.dependencies[1]!);
    if (u === undefined || v === undefined) throw new Error(`Internal IFS wind dependency missing for ${id}`);
    const wind = deriveWind(u, v);
    return {
      id,
      level: publicLevel(canonical.level),
      temporal: { type: "instantaneous" },
      values: {
        windSpeedMs: wind.speedMs,
        windDirectionDeg: wind.directionDeg,
      },
    };
  }

  const temperatureK = rawValues.get("temperature_2m");
  const dewPointK = rawValues.get("dew_point_2m");
  if (temperatureK === undefined || dewPointK === undefined) {
    throw new Error(`Internal IFS 2 m humidity dependency missing for ${id}`);
  }
  const temperatureC = temperatureK - 273.15;
  const dewPointC = dewPointK - 273.15;
  const relativeHumidityPct = deriveRelativeHumidityFromDewPointPct(temperatureC, dewPointC);

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
    throw new Error("Internal IFS surface-pressure dependency missing for specific_humidity_2m");
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

function normalizeFieldValue(id: IfsRawFieldId, value: number): number {
  switch (id) {
    case "surface_geopotential_height":
      return value / 9.80665;
    case "temperature_2m":
    case "dew_point_2m":
      return value - 273.15;
    case "total_precipitation":
      return value * 1_000;
    case "low_cloud_cover":
    case "middle_cloud_cover":
    case "high_cloud_cover":
    case "total_atmosphere_cloud_cover":
      return value * 100;
    default:
      return value;
  }
}

function publicLevel(level: NonIsobaricLevel): NonIsobaricFieldResult["level"] {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m": return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function deriveRelativeHumidityFromDewPointPct(temperatureC: number, dewPointC: number): number {
  const saturationAtTemperature = deriveSaturationVaporPressureHpa(temperatureC);
  const vaporPressure = deriveSaturationVaporPressureHpa(dewPointC);
  return Math.max(0, Math.min(100, 100 * vaporPressure / saturationAtTemperature));
}

function coriolisParameterS1(latitudeDeg: number): number {
  const earthAngularVelocityS1 = 7.292115e-5;
  return 2 * earthAngularVelocityS1 * Math.sin(latitudeDeg * Math.PI / 180);
}

function dependency(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`IFS derived-variable dependency missing: ${id}@${pressureHpa}hPa`);
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
      throw new Error("IFS selected fields resolved to inconsistent grid points");
    }
  }
}
