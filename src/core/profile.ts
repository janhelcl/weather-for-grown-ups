import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NomadsCache, type CachedFile } from "../cache/nomads-cache.js";
import { GfsS3SubsetCache } from "../cache/s3-subset-cache.js";
import {
  expandRequestedFields,
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldDefinition,
  type NonIsobaricLevel,
  type RawNonIsobaricFieldDefinition,
} from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  profileQuerySchema,
  type ProfileQueryInput,
  type ProfileSourceId,
  type VariableId,
} from "../schema/query.js";
import { NomadsProfileSource, S3ProfileSource } from "../sources/profile-source.js";
import type { ProfileDataSource } from "../sources/types.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import type {
  DecodedValue,
  FieldTemporalResult,
  ForecastInterval,
  GribDecoderName,
  NonIsobaricFieldResult,
  ProfileLevel,
  ProfileResult,
} from "./types.js";

export interface ProfileCache {
  fetch(url: string): Promise<CachedFile>;
}

export interface PointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface ProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  wgrib2Path?: string;
  cache?: ProfileCache;
  decoder?: PointDecoder;
  latestRunProvider?: LatestRunProvider;
  sources?: Partial<Record<ProfileSourceId, ProfileDataSource>>;
}

export class ProfileService {
  private readonly decoder: PointDecoder;
  private readonly latestRunProvider: LatestRunProvider;
  private readonly sources: Record<ProfileSourceId, ProfileDataSource>;

  constructor(options: ProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    const nomadsCache = options.cache ?? new NomadsCache(join(cacheDir, "grib"), limiter);

    this.sources = {
      nomads: new NomadsProfileSource(nomadsCache as NomadsCache),
      s3: new S3ProfileSource(new GfsS3SubsetCache(join(cacheDir, "s3"))),
      ...options.sources,
    };
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
  }

  async getProfile(input: ProfileQueryInput): Promise<ProfileResult> {
    const query = profileQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const requestedVariables = query.variables ?? [];
    const pressureLevelsHpa = query.pressureLevelsHpa ?? [];
    const requestedFields = query.fields ?? [];
    const variables = expandRequestedVariables(requestedVariables);
    const fields = expandRequestedFields(requestedFields);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        })
      : query.run === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun()
        : parseGfsRun(query.run);
    const fh = forecastHour(run, validTime);
    const source = this.sources[query.source];

    const cached = await source.fetch({
      run,
      forecastHour: fh,
      latitude: query.latitude,
      longitude: query.longitude,
      variables,
      pressureLevelsHpa,
      fields,
    });
    const values = await this.decoder.extractPoint(cached.path, query.longitude, query.latitude);
    const firstValue = values[0];
    if (!firstValue) throw new Error("No values decoded from GFS response");

    assertPressureComplete(values, variables.map((variable) => variable.gfsCode), pressureLevelsHpa);
    assertFieldsComplete(values, fields);

    const levelMap = new Map<number, ProfileLevel>();
    for (const pressureHpa of pressureLevelsHpa) levelMap.set(pressureHpa, { pressureHpa });

    for (const value of values) {
      if (value.pressureHpa === undefined) continue;
      const level = levelMap.get(value.pressureHpa);
      if (!level) continue;
      applyDecodedPressureValue(level, value);
    }

    for (const level of levelMap.values()) {
      applyDerivedPressureValues(level, requestedVariables);
    }

    const fieldResults = requestedFields.map((id) =>
      buildFieldResult(NON_ISOBARIC_FIELD_CATALOG[id], values, run),
    );

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: firstValue.gridPoint,
      levels: [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa),
      ...(fieldResults.length > 0 ? { fields: fieldResults } : {}),
      source: {
        provider: source.provider,
        access: source.access,
        decoder: this.decoder.engine ?? "wgrib2",
        cacheHit: cached.cacheHit,
      },
    };
  }
}

function applyDecodedPressureValue(level: ProfileLevel, value: DecodedValue): void {
  switch (value.code) {
    case "TMP": level.temperatureC = value.value - 273.15; break;
    case "RH": level.relativeHumidityPct = value.value; break;
    case "UGRD": level.uWindMs = value.value; break;
    case "VGRD": level.vWindMs = value.value; break;
    case "HGT": level.geopotentialHeightGpm = value.value; break;
    case "SPFH": level.specificHumidityKgKg = value.value; break;
    case "VVEL": level.verticalVelocityPaS = value.value; break;
    case "DZDT": level.geometricVerticalVelocityMs = value.value; break;
    case "ABSV": level.absoluteVorticityS1 = value.value; break;
    case "TCDC": level.totalCloudCoverPct = value.value; break;
    case "CLWMR": level.cloudWaterMixingRatioKgKg = value.value; break;
    case "O3MR": level.ozoneMixingRatioKgKg = value.value; break;
  }
}

function applyDerivedPressureValues(level: ProfileLevel, requestedVariables: readonly VariableId[]): void {
  const requested = new Set(requestedVariables);

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

function dependency(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) {
    throw new Error(`Internal derived-variable dependency missing: ${id}@${pressureHpa}mb`);
  }
  return value;
}

function buildFieldResult(
  definition: NonIsobaricFieldDefinition,
  values: DecodedValue[],
  run: Date,
): NonIsobaricFieldResult {
  if (definition.kind === "raw") {
    const decoded = values.find((value) => matchesRawField(definition, value));
    if (!decoded) throw new Error(`Internal completeness error for ${definition.id}`);
    const output = definition.outputs[0];
    return {
      id: definition.id,
      level: publicLevel(definition.level),
      temporal: temporalResult(definition, decoded, run),
      values: { [output.field]: normalizeFieldValue(definition, decoded.value) },
    };
  }

  const uDefinition = NON_ISOBARIC_FIELD_CATALOG[definition.dependencies[0]] as RawNonIsobaricFieldDefinition;
  const vDefinition = NON_ISOBARIC_FIELD_CATALOG[definition.dependencies[1]] as RawNonIsobaricFieldDefinition;
  const u = values.find((value) => matchesRawField(uDefinition, value));
  const v = values.find((value) => matchesRawField(vDefinition, value));
  if (!u || !v) throw new Error(`Internal completeness error for ${definition.id}`);
  const windValue = deriveWind(u.value, v.value);
  return {
    id: definition.id,
    level: publicLevel(definition.level),
    temporal: { type: "instantaneous" },
    values: {
      windSpeedMs: windValue.speedMs,
      windDirectionDeg: windValue.directionDeg,
    },
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

function temporalResult(
  definition: RawNonIsobaricFieldDefinition,
  value: DecodedValue,
  run: Date,
): FieldTemporalResult {
  if (definition.temporalSemantics === "instantaneous") return { type: "instantaneous" };

  const interval = definition.temporalSemantics === "accumulation"
    ? value.accumulation
    : value.average;
  if (!interval) {
    throw new Error(`Decoded ${definition.id} is missing its ${definition.temporalSemantics} interval`);
  }
  return intervalResult(definition.temporalSemantics, interval, run);
}

function intervalResult(
  type: "accumulation" | "average",
  interval: ForecastInterval,
  run: Date,
): Exclude<FieldTemporalResult, { type: "instantaneous" }> {
  return {
    type,
    ...interval,
    startTime: new Date(run.getTime() + interval.startForecastHour * 3_600_000).toISOString(),
    endTime: new Date(run.getTime() + interval.endForecastHour * 3_600_000).toISOString(),
  };
}

function normalizeFieldValue(definition: RawNonIsobaricFieldDefinition, value: number): number {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function matchesRawField(definition: RawNonIsobaricFieldDefinition, value: DecodedValue): boolean {
  if (definition.gfsCode !== value.code) return false;

  const levelMatches = definition.level.type === "surface"
    ? value.surface === true
    : definition.level.type === "height_above_ground_m"
      ? value.heightAboveGroundM === definition.level.heightM
      : value.namedVertical === definition.level.gribLevel;
  if (!levelMatches) return false;

  switch (definition.temporalSemantics) {
    case "instantaneous": return value.accumulation === undefined && value.average === undefined;
    case "accumulation": return value.accumulation !== undefined;
    case "average": return value.average !== undefined;
  }
}

function assertPressureComplete(values: DecodedValue[], codes: string[], levels: number[]): void {
  const seen = new Set(
    values
      .filter((value) => value.pressureHpa !== undefined)
      .map((value) => `${value.code}@${value.pressureHpa}`),
  );
  const missing = [...new Set(codes)].flatMap((code) =>
    [...new Set(levels)]
      .filter((level) => !seen.has(`${code}@${level}`))
      .map((level) => `${code}@${level}mb`),
  );
  if (missing.length > 0) {
    throw new Error(`Decoded GFS data is missing requested fields: ${missing.join(", ")}`);
  }
}

function assertFieldsComplete(values: DecodedValue[], fields: RawNonIsobaricFieldDefinition[]): void {
  const missing = fields
    .filter((field) => !values.some((value) => matchesRawField(field, value)))
    .map((field) => `${field.id} (${field.gfsCode}@${field.level.gribLevel}, ${field.temporalSemantics})`);
  if (missing.length > 0) {
    throw new Error(`Decoded GFS data is missing requested fields: ${missing.join(", ")}`);
  }
}
