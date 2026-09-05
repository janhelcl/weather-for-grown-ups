import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { CachedGfsAnalysisFileStore, CachedGfsAnalysisSource } from "../cache/historical-gfs-cache.js";
import { RoutedGfsAnalysisSource } from "../sources/gfs-analysis-routed.js";
import type {
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisPointRow,
} from "../sources/gfs-analysis.js";
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
import { NCEI_GFS_GRID4_ANALYSIS_START } from "../sources/ncei-gfs-history.js";
import type { ProfileLevel } from "./types.js";

const CAVEAT = "GFS model analysis; not a direct observation or homogeneous climatological reanalysis" as const;
const WATER_VAPOR_TO_DRY_AIR_GAS_CONSTANT_RATIO = 0.622;

type HistoricalRawVariableId = Exclude<
  HistoricalGfsVariableId,
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
  pressureAxisGroup: HistoricalPressureAxisGroup;
  apply(level: ProfileLevel, value: number): void;
}

const RAW_HISTORY_VARIABLES: Record<HistoricalRawVariableId, RawHistoryVariable> = {
  temperature: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.temperatureC = value - 273.15; },
  },
  relative_humidity: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.relativeHumidityPct = value; },
  },
  u_wind: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.uWindMs = value; },
  },
  v_wind: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.vWindMs = value; },
  },
  geopotential_height: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.geopotentialHeightGpm = value; },
  },
  specific_humidity: {
    pressureAxisGroup: "full_profile",
    apply: (level, value) => { level.specificHumidityKgKg = value; },
  },
  vertical_velocity: {
    pressureAxisGroup: "vertical_velocity",
    apply: (level, value) => { level.verticalVelocityPaS = value; },
  },
  absolute_vorticity: {
    pressureAxisGroup: "absolute_vorticity",
    apply: (level, value) => { level.absoluteVorticityS1 = value; },
  },
  cloud_water_mixing_ratio: {
    pressureAxisGroup: "cloud_mixing_ratio",
    apply: (level, value) => { level.cloudWaterMixingRatioKgKg = value; },
  },
  ozone_mixing_ratio: {
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

const NATIVE_SPECIFIC_HUMIDITY_DEPENDENCIES: Partial<
  Record<HistoricalGfsVariableId, readonly HistoricalRawVariableId[]>
> = {
  mixing_ratio: ["specific_humidity"],
  virtual_temperature: ["temperature", "specific_humidity"],
  air_density: ["temperature", "specific_humidity"],
  wet_bulb_temperature: ["temperature", "specific_humidity"],
  equivalent_potential_temperature: ["temperature", "specific_humidity"],
};

export interface HistoricalProfileServiceOptions {
  cacheDir?: string;
  accessPolicy?: UpstreamAccessPolicy;
  source?: HistoricalAnalysisDataSource;
  now?: () => Date;
  allowNonAnalysisCycle?: boolean;
  minimumTime?: Date;
  nativeSpecificHumidity?: boolean;
}

export interface HistoricalProfileLoadOptions {
  source: HistoricalAnalysisDataSource;
  analysisTime: Date;
  latitude: number;
  longitude: number;
  variables: readonly HistoricalGfsVariableId[];
  pressureLevelsHpa: readonly number[];
  nativeSpecificHumidity: boolean;
}

export interface HistoricalProfileLoadResult {
  gridPoint: { latitude: number; longitude: number };
  levels: ProfileLevel[];
  responses: HistoricalAnalysisPointResponse[];
}

export class HistoricalProfileService {
  private readonly source: HistoricalAnalysisDataSource;
  private readonly now: () => Date;
  private readonly allowNonAnalysisCycle: boolean;
  private readonly minimumTime: Date;
  private readonly nativeSpecificHumidity: boolean;

  constructor(options: HistoricalProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const accessPolicy = options.accessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    const awsAccessPolicy = new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.noaaAws);
    this.source = options.source ?? new CachedGfsAnalysisSource(
      join(cacheDir, "gfs-analysis"),
      new RoutedGfsAnalysisSource({
        nceiAccessPolicy: accessPolicy,
        awsAccessPolicy,
        fileStore: new CachedGfsAnalysisFileStore(join(cacheDir, "gfs-analysis-fileserver")),
      }),
    );
    this.now = options.now ?? (() => new Date());
    this.allowNonAnalysisCycle = options.allowNonAnalysisCycle ?? false;
    this.minimumTime = options.minimumTime ?? NCEI_GFS_GRID4_ANALYSIS_START;
    this.nativeSpecificHumidity = options.nativeSpecificHumidity ?? false;
  }

  async getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult> {
    const query = this.allowNonAnalysisCycle
      ? historicalProfileQuerySchema.safeExtend({ analysisTime: isoDateTimeSchema }).parse(input)
      : historicalProfileQuerySchema.parse(input);
    const analysisTime = new Date(query.analysisTime);
    if (analysisTime < this.minimumTime) {
      throw new Error(
        `GFS Grid 4 history begins at ${this.minimumTime.toISOString()} for this data source`,
      );
    }
    if (analysisTime > this.now()) {
      throw new Error("Historical GFS analysisTime must not be in the future");
    }

    const loaded = await loadHistoricalProfileData({
      source: this.source,
      analysisTime,
      latitude: query.latitude,
      longitude: query.longitude,
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
      nativeSpecificHumidity: this.nativeSpecificHumidity,
    });
    const firstResponse = loaded.responses[0];
    if (!firstResponse) throw new Error("Historical GFS query resolved no source variables");
    const publicSource = publicHistoricalSource(firstResponse);

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: loaded.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      levels: loaded.levels,
      source: {
        ...publicSource,
        dataset: firstResponse.dataset,
        cacheHit: loaded.responses.every((response) => response.cacheHit),
      },
      caveat: CAVEAT,
    };
  }
}

export async function loadHistoricalProfileData(
  options: HistoricalProfileLoadOptions,
): Promise<HistoricalProfileLoadResult> {
  const rawVariables = expandHistoricalVariables(options.variables, options.nativeSpecificHumidity);
  const groups = groupHistoricalVariablesByPressureAxis(rawVariables);
  const responses: HistoricalAnalysisPointResponse[] = [];
  const mergedLevels = new Map<number, ProfileLevel>();
  for (const pressureHpa of options.pressureLevelsHpa) {
    mergedLevels.set(levelKey(pressureHpa), { pressureHpa });
  }
  let gridPoint = { latitude: options.latitude, longitude: options.longitude };

  for (const group of groups) {
    const response = await options.source.fetch({
      analysisTime: options.analysisTime,
      latitude: options.latitude,
      longitude: options.longitude,
      variables: group,
    });
    responses.push(response);
    const parsed = parseHistoricalProfileRows(
      response.rows,
      group,
      options.pressureLevelsHpa,
      { latitude: options.latitude, longitude: options.longitude },
    );
    gridPoint = parsed.gridPoint;
    mergeHistoricalLevels(mergedLevels, parsed.levels);
  }

  const levels = [...mergedLevels.values()].sort((a, b) => b.pressureHpa - a.pressureHpa);
  for (const level of levels) {
    applyHistoricalDerivedValues(level, options.variables);
  }
  assertRequestedVariablesComplete(levels, options.variables);

  return { gridPoint, levels, responses };
}

function publicHistoricalSource(
  response: HistoricalAnalysisPointResponse,
): Pick<HistoricalProfileResult["source"], "provider" | "access"> {
  if (response.provider === "NCAR GDEX" || response.access === "gdex_thredds_ncss") {
    throw new Error("gfs-analysis source returned archive-only GDEX provenance");
  }
  return { provider: response.provider, access: response.access };
}

function expandHistoricalVariables(
  ids: readonly HistoricalGfsVariableId[],
  nativeSpecificHumidity: boolean,
): HistoricalRawVariableId[] {
  const result = new Set<HistoricalRawVariableId>();
  for (const id of ids) {
    if (id === "specific_humidity" && !nativeSpecificHumidity) {
      for (const dependency of DERIVED_DEPENDENCIES[id] ?? []) result.add(dependency);
      continue;
    }
    if (id in RAW_HISTORY_VARIABLES) {
      result.add(id as HistoricalRawVariableId);
      continue;
    }
    const dependencies = nativeSpecificHumidity
      ? NATIVE_SPECIFIC_HUMIDITY_DEPENDENCIES[id] ?? DERIVED_DEPENDENCIES[id] ?? []
      : DERIVED_DEPENDENCIES[id] ?? [];
    for (const dependency of dependencies) result.add(dependency);
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

export function parseHistoricalProfileRows(
  rows: readonly HistoricalAnalysisPointRow[],
  rawVariables: readonly HistoricalRawVariableId[],
  pressureLevelsHpa: readonly number[],
  requestedPoint: { latitude: number; longitude: number },
): ParsedHistoricalProfile {
  const requested = new Set(pressureLevelsHpa.map(levelKey));
  const levelMap = new Map<number, ProfileLevel>();
  for (const pressureHpa of pressureLevelsHpa) levelMap.set(levelKey(pressureHpa), { pressureHpa });

  let gridPoint = requestedPoint;
  for (const row of rows) {
    if (row.pressureHpa === undefined) continue;
    const key = levelKey(row.pressureHpa);
    if (!requested.has(key)) continue;
    const level = levelMap.get(key);
    if (!level) continue;

    for (const id of rawVariables) {
      const value = row.values[id];
      if (value !== undefined) RAW_HISTORY_VARIABLES[id].apply(level, value);
    }
    gridPoint = { latitude: row.latitude, longitude: row.longitude };
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

function levelKey(value: number): number {
  return Math.round(value * 100) / 100;
}
