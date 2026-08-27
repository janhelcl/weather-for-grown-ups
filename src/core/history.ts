import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveEquivalentPotentialTemperatureK,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveSaturationVaporPressureHpa,
  deriveSpecificHumidityFromMixingRatioKgKg,
  deriveVirtualTemperatureC,
  deriveWetBulbTemperatureC,
} from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import {
  historicalProfileQuerySchema,
  type HistoricalGfsVariableId,
  type HistoricalProfileQueryInput,
} from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import { isoDateTimeSchema } from "../schema/query.js";
import {
  NCEI_GFS_GRID4_ANALYSIS_START,
  NceiGfsHistorySource,
  type HistoricalAnalysisDataSource,
  type HistoricalAnalysisResponse,
} from "../sources/ncei-gfs-history.js";
import type { ProfileLevel } from "./types.js";

const CAVEAT = "GFS model analysis; not a direct observation or homogeneous climatological reanalysis" as const;
const WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO = 0.622;

type HistoricalRawVariableId = Exclude<
  HistoricalGfsVariableId,
  | "specific_humidity"
  | "wind"
  | "dew_point"
  | "potential_temperature"
  | "mixing_ratio"
  | "virtual_temperature"
  | "air_density"
  | "wet_bulb_temperature"
  | "equivalent_potential_temperature"
>;

type HistoricalPressureAxisGroup =
  | "full_profile"
  | "vertical_velocity"
  | "absolute_vorticity"
  | "cloud_mixing_ratio"
  | "ozone_mixing_ratio";

interface RawHistoryVariable {
  ncssName: string;
  pressureAxisGroup: HistoricalPressureAxisGroup;
  apply(level: ProfileLevel, value: number): void;
}

const RAW_HISTORY_VARIABLES: Record<HistoricalRawVariableId, RawHistoryVariable> = {
  temperature: {
    ncssName: "Temperature_isobaric",
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.temperatureC = value - 273.15; },
  },
  relative_humidity: {
    ncssName: "Relative_humidity_isobaric",
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.relativeHumidityPct = value; },
  },
  u_wind: {
    ncssName: "u-component_of_wind_isobaric",
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.uWindMs = value; },
  },
  v_wind: {
    ncssName: "v-component_of_wind_isobaric",
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.vWindMs = value; },
  },
  geopotential_height: {
    ncssName: "Geopotential_height_isobaric",
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.geopotentialHeightGpm = value; },
  },
  vertical_velocity: {
    ncssName: "Vertical_velocity_pressure_isobaric",
    pressureAxisGroup: "vertical_velocity",
    apply: (level, value) => { level.verticalVelocityPaS = value; },
  },
  absolute_vorticity: {
    ncssName: "Absolute_vorticity_isobaric",
    pressureAxisGroup: "absolute_vorticity",
    apply: (level, value) => { level.absoluteVorticityS1 = value; },
  },
  cloud_water_mixing_ratio: {
    ncssName: "Cloud_mixing_ratio_isobaric",
    pressureAxisGroup: "cloud_mixing_ratio",
    apply: (level, value) => { level.cloudWaterMixingRatioKgKg = value; },
  },
  ozone_mixing_ratio: {
    ncssName: "Ozone_Mixing_Ratio_isobaric",
    pressureAxisGroup: "ozone_mixing_ratio",
    apply: (level, value) => { level.ozoneMixingRatioKgKg = value; },
  },
};

const DERIVED_DEPENDENCIES: Partial<Record<HistoricalGfsVariableId, readonly HistoricalRawVariableId[]>> = {
  specific_humidity: ["temperature", "relative_humidity"],
  wind: ["u_wind", "v_wind"],
  dew_point: ["temperature", "relative_humidity"],
  potential_temperature: ["temperature"],
  mixing_ratio: ["temperature", "relative_humidity"],
  virtual_temperature: ["temperature", "relative_humidity"],
  air_density: ["temperature", "relative_humidity"],
  wet_bulb_temperature: ["temperature", "relative_humidity"],
  equivalent_potential_temperature: ["temperature", "relative_humidity"],
};

export interface HistoricalProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: HistoricalAnalysisDataSource;
  now?: () => Date;
  allowNonAnalysisCycle?: boolean;
  minimumTime?: Date;
}

export class HistoricalProfileService {
  private readonly source: HistoricalAnalysisDataSource;
  private readonly now: () => Date;
  private readonly allowNonAnalysisCycle: boolean;
  private readonly minimumTime: Date;

  constructor(options: HistoricalProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    this.source = options.source ?? new NceiGfsHistorySource({
      cacheDir: join(cacheDir, "ncei-history"),
      limiter,
    });
    this.now = options.now ?? (() => new Date());
    this.allowNonAnalysisCycle = options.allowNonAnalysisCycle ?? false;
    this.minimumTime = options.minimumTime ?? NCEI_GFS_GRID4_ANALYSIS_START;
  }

  async getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult> {
    const query = this.allowNonAnalysisCycle
      ? historicalProfileQuerySchema.safeExtend({ analysisTime: isoDateTimeSchema }).parse(input)
      : historicalProfileQuerySchema.parse(input);
    const analysisTime = new Date(query.analysisTime);
    if (analysisTime < this.minimumTime) {
      throw new Error(
        `NCEI GFS Grid 4 history begins at ${this.minimumTime.toISOString()} for this data source`,
      );
    }
    if (analysisTime > this.now()) {
      throw new Error("Historical GFS analysisTime must not be in the future");
    }

    const rawVariables = expandHistoricalVariables(query.variables);
    const groups = groupHistoricalVariablesByPressureAxis(rawVariables);
    const responses: HistoricalAnalysisResponse[] = [];
    const mergedLevels = new Map<number, ProfileLevel>();
    for (const pressureHpa of query.pressureLevelsHpa) {
      mergedLevels.set(levelKey(pressureHpa), { pressureHpa });
    }
    let gridPoint = { latitude: query.latitude, longitude: query.longitude };

    for (const group of groups) {
      const response = await this.source.fetch({
        analysisTime,
        latitude: query.latitude,
        longitude: query.longitude,
        variables: group.map((id) => RAW_HISTORY_VARIABLES[id].ncssName),
      });
      responses.push(response);
      const parsed = parseHistoricalProfileCsv(
        response.csv,
        group,
        query.pressureLevelsHpa,
        { latitude: query.latitude, longitude: query.longitude },
      );
      gridPoint = parsed.gridPoint;
      mergeHistoricalLevels(mergedLevels, parsed.levels);
    }

    const levels = [...mergedLevels.values()].sort((a, b) => b.pressureHpa - a.pressureHpa);
    for (const level of levels) {
      applyHistoricalDerivedValues(level, query.variables);
    }
    assertRequestedVariablesComplete(levels, query.variables);

    const firstResponse = responses[0];
    if (!firstResponse) throw new Error("Historical GFS query resolved no source variables");

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      levels,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        dataset: firstResponse.dataset,
        cacheHit: responses.every((response) => response.cacheHit),
      },
      caveat: CAVEAT,
    };
  }
}

function expandHistoricalVariables(ids: readonly HistoricalGfsVariableId[]): HistoricalRawVariableId[] {
  const result = new Set<HistoricalRawVariableId>();
  for (const id of ids) {
    if (id in RAW_HISTORY_VARIABLES) {
      result.add(id as HistoricalRawVariableId);
      continue;
    }
    for (const dependency of DERIVED_DEPENDENCIES[id] ?? []) result.add(dependency);
  }
  return [...result];
}

function groupHistoricalVariablesByPressureAxis(
  ids: readonly HistoricalRawVariableId[],
): HistoricalRawVariableId[][] {
  const groups = new Map<HistoricalPressureAxisGroup, HistoricalRawVariableId[]>();
  for (const id of ids) {
    const key = RAW_HISTORY_VARIABLES[id].pressureAxisGroup;
    const group = groups.get(key) ?? [];
    group.push(id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function mergeHistoricalLevels(
  target: Map<number, ProfileLevel>,
  incoming: readonly ProfileLevel[],
): void {
  for (const level of incoming) {
    const key = levelKey(level.pressureHpa);
    const existing = target.get(key);
    if (!existing) continue;
    Object.assign(existing, level);
  }
}

interface ParsedHistoricalProfile {
  gridPoint: { latitude: number; longitude: number };
  levels: ProfileLevel[];
}

export function parseHistoricalProfileCsv(
  csv: string,
  rawVariables: readonly HistoricalRawVariableId[],
  pressureLevelsHpa: readonly number[],
  requestedPoint: { latitude: number; longitude: number },
): ParsedHistoricalProfile {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("NCEI historical GFS response contains no data rows");

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const pressureIndex = findHeaderIndex(headers, [
    "vertCoord",
    "isobaric",
    "isobaric1",
    "isobaric2",
    "isobaric3",
    "isobaric4",
    "isobaric5",
    "isobaric6",
    "isobaric7",
  ]);
  if (pressureIndex < 0) throw new Error("NCEI historical GFS response is missing a pressure coordinate");

  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const variableIndexes = new Map<HistoricalRawVariableId, number>();
  for (const id of rawVariables) {
    const name = RAW_HISTORY_VARIABLES[id].ncssName;
    const aliases = name.startsWith("u-component") || name.startsWith("v-component")
      ? [name, name.replace("-component", "component")]
      : [name];
    const index = findHeaderIndex(headers, aliases);
    if (index < 0) throw new Error(`NCEI historical GFS response is missing variable ${name}`);
    variableIndexes.set(id, index);
  }

  const requested = new Set(pressureLevelsHpa.map(levelKey));
  const levelMap = new Map<number, ProfileLevel>();
  for (const pressureHpa of pressureLevelsHpa) levelMap.set(levelKey(pressureHpa), { pressureHpa });

  let gridPoint = requestedPoint;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const rawPressure = numericCell(cells[pressureIndex]);
    if (rawPressure === undefined) continue;
    const pressureHpa = rawPressure > 2_000 ? rawPressure / 100 : rawPressure;
    const key = levelKey(pressureHpa);
    if (!requested.has(key)) continue;
    const level = levelMap.get(key);
    if (!level) continue;

    for (const id of rawVariables) {
      const index = variableIndexes.get(id);
      if (index === undefined) continue;
      const value = numericCell(cells[index]);
      if (value !== undefined) RAW_HISTORY_VARIABLES[id].apply(level, value);
    }

    const latitude = latitudeIndex < 0 ? undefined : numericCell(cells[latitudeIndex]);
    const longitude = longitudeIndex < 0 ? undefined : numericCell(cells[longitudeIndex]);
    if (latitude !== undefined && longitude !== undefined) {
      gridPoint = {
        latitude,
        longitude: longitude > 180 ? longitude - 360 : longitude,
      };
    }
  }

  return {
    gridPoint,
    levels: [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa),
  };
}

function applyHistoricalDerivedValues(level: ProfileLevel, requestedVariables: readonly HistoricalGfsVariableId[]): void {
  const requested = new Set(requestedVariables);
  const moistureDerivedRequested = [
    "specific_humidity",
    "mixing_ratio",
    "virtual_temperature",
    "air_density",
    "wet_bulb_temperature",
    "equivalent_potential_temperature",
  ].some((id) => requested.has(id as HistoricalGfsVariableId));

  if (
    moistureDerivedRequested
    && level.specificHumidityKgKg === undefined
    && level.temperatureC !== undefined
    && level.relativeHumidityPct !== undefined
  ) {
    level.specificHumidityKgKg = deriveSpecificHumidityFromRelativeHumidity(
      level.temperatureC,
      level.relativeHumidityPct,
      level.pressureHpa,
    );
  }
  if (requested.has("wind") && level.uWindMs !== undefined && level.vWindMs !== undefined) {
    const wind = deriveWind(level.uWindMs, level.vWindMs);
    level.windSpeedMs = wind.speedMs;
    level.windDirectionDeg = wind.directionDeg;
  }
  if (requested.has("dew_point") && level.temperatureC !== undefined && level.relativeHumidityPct !== undefined) {
    level.dewPointC = deriveDewPointC(level.temperatureC, level.relativeHumidityPct);
  }
  if (requested.has("potential_temperature") && level.temperatureC !== undefined) {
    level.potentialTemperatureK = derivePotentialTemperatureK(level.temperatureC, level.pressureHpa);
  }
  if (requested.has("mixing_ratio") && level.specificHumidityKgKg !== undefined) {
    level.mixingRatioKgKg = deriveMixingRatioKgKg(level.specificHumidityKgKg);
  }
  if (requested.has("virtual_temperature") && level.temperatureC !== undefined && level.specificHumidityKgKg !== undefined) {
    level.virtualTemperatureC = deriveVirtualTemperatureC(level.temperatureC, level.specificHumidityKgKg);
  }
  if (requested.has("air_density") && level.temperatureC !== undefined && level.specificHumidityKgKg !== undefined) {
    level.airDensityKgM3 = deriveAirDensityKgM3(level.temperatureC, level.specificHumidityKgKg, level.pressureHpa);
  }
  if (requested.has("wet_bulb_temperature") && level.temperatureC !== undefined && level.specificHumidityKgKg !== undefined) {
    level.wetBulbTemperatureC = deriveWetBulbTemperatureC(level.temperatureC, level.specificHumidityKgKg, level.pressureHpa);
  }
  if (requested.has("equivalent_potential_temperature") && level.temperatureC !== undefined && level.specificHumidityKgKg !== undefined) {
    level.equivalentPotentialTemperatureK = deriveEquivalentPotentialTemperatureK(
      level.temperatureC,
      level.specificHumidityKgKg,
      level.pressureHpa,
    );
  }
}

function deriveSpecificHumidityFromRelativeHumidity(
  temperatureC: number,
  relativeHumidityPct: number,
  pressureHpa: number,
): number {
  const saturationVaporPressureHpa = deriveSaturationVaporPressureHpa(temperatureC);
  const vaporPressureHpa = saturationVaporPressureHpa * Math.max(0, Math.min(100, relativeHumidityPct)) / 100;
  if (!(vaporPressureHpa < pressureHpa)) {
    throw new Error(`Historical vapor pressure ${vaporPressureHpa} hPa is not below ambient pressure ${pressureHpa} hPa`);
  }
  const mixingRatioKgKg = WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO
    * vaporPressureHpa / (pressureHpa - vaporPressureHpa);
  return deriveSpecificHumidityFromMixingRatioKgKg(mixingRatioKgKg);
}

function assertRequestedVariablesComplete(
  levels: readonly ProfileLevel[],
  variables: readonly HistoricalGfsVariableId[],
): void {
  const missing: string[] = [];
  for (const level of levels) {
    for (const id of variables) {
      if (!hasHistoricalValue(level, id)) missing.push(`${id}@${level.pressureHpa}mb`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Historical GFS analysis is missing requested fields: ${missing.join(", ")}`);
  }
}

function hasHistoricalValue(level: ProfileLevel, id: HistoricalGfsVariableId): boolean {
  switch (id) {
    case "temperature": return level.temperatureC !== undefined;
    case "relative_humidity": return level.relativeHumidityPct !== undefined;
    case "u_wind": return level.uWindMs !== undefined;
    case "v_wind": return level.vWindMs !== undefined;
    case "geopotential_height": return level.geopotentialHeightGpm !== undefined;
    case "specific_humidity": return level.specificHumidityKgKg !== undefined;
    case "vertical_velocity": return level.verticalVelocityPaS !== undefined;
    case "absolute_vorticity": return level.absoluteVorticityS1 !== undefined;
    case "cloud_water_mixing_ratio": return level.cloudWaterMixingRatioKgKg !== undefined;
    case "ozone_mixing_ratio": return level.ozoneMixingRatioKgKg !== undefined;
    case "wind": return level.windSpeedMs !== undefined && level.windDirectionDeg !== undefined;
    case "dew_point": return level.dewPointC !== undefined;
    case "potential_temperature": return level.potentialTemperatureK !== undefined;
    case "mixing_ratio": return level.mixingRatioKgKg !== undefined;
    case "virtual_temperature": return level.virtualTemperatureC !== undefined;
    case "air_density": return level.airDensityKgM3 !== undefined;
    case "wet_bulb_temperature": return level.wetBulbTemperatureC !== undefined;
    case "equivalent_potential_temperature": return level.equivalentPotentialTemperatureK !== undefined;
  }
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").replace(/\[.*$/, "").trim();
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function numericCell(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "nan") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function levelKey(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  cells.push(value);
  return cells;
}
