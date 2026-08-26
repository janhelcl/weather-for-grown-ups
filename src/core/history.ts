import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { deriveDewPointC, derivePotentialTemperatureK } from "../derived/thermodynamics.js";
import { deriveWind } from "../derived/wind.js";
import {
  historicalProfileQuerySchema,
  type HistoricalGfsVariableId,
  type HistoricalProfileQueryInput,
} from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import {
  NCEI_GFS_GRID4_ANALYSIS_START,
  NceiGfsHistorySource,
  type HistoricalAnalysisDataSource,
} from "../sources/ncei-gfs-history.js";
import type { ProfileLevel } from "./types.js";

const CAVEAT = "GFS model analysis; not a direct observation or homogeneous climatological reanalysis" as const;

type HistoricalRawVariableId = Exclude<
  HistoricalGfsVariableId,
  "wind" | "dew_point" | "potential_temperature"
>;

interface RawHistoryVariable {
  ncssName: string;
  apply(level: ProfileLevel, value: number): void;
}

const RAW_HISTORY_VARIABLES: Record<HistoricalRawVariableId, RawHistoryVariable> = {
  temperature: {
    ncssName: "Temperature_isobaric",
    apply: (level, value) => { level.temperatureC = value - 273.15; },
  },
  relative_humidity: {
    ncssName: "Relative_humidity_isobaric",
    apply: (level, value) => { level.relativeHumidityPct = value; },
  },
  u_wind: {
    ncssName: "u-component_of_wind_isobaric",
    apply: (level, value) => { level.uWindMs = value; },
  },
  v_wind: {
    ncssName: "v-component_of_wind_isobaric",
    apply: (level, value) => { level.vWindMs = value; },
  },
  geopotential_height: {
    ncssName: "Geopotential_height_isobaric",
    apply: (level, value) => { level.geopotentialHeightGpm = value; },
  },
  vertical_velocity: {
    ncssName: "Vertical_velocity_pressure_isobaric",
    apply: (level, value) => { level.verticalVelocityPaS = value; },
  },
  absolute_vorticity: {
    ncssName: "Absolute_vorticity_isobaric",
    apply: (level, value) => { level.absoluteVorticityS1 = value; },
  },
};

const DERIVED_DEPENDENCIES: Partial<Record<HistoricalGfsVariableId, readonly HistoricalRawVariableId[]>> = {
  wind: ["u_wind", "v_wind"],
  dew_point: ["temperature", "relative_humidity"],
  potential_temperature: ["temperature"],
};

export interface HistoricalProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  source?: HistoricalAnalysisDataSource;
  now?: () => Date;
}

export class HistoricalProfileService {
  private readonly source: HistoricalAnalysisDataSource;
  private readonly now: () => Date;

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
  }

  async getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult> {
    const query = historicalProfileQuerySchema.parse(input);
    const analysisTime = new Date(query.analysisTime);
    if (analysisTime < NCEI_GFS_GRID4_ANALYSIS_START) {
      throw new Error(
        `NCEI GFS Grid 4 analysis history begins at ${NCEI_GFS_GRID4_ANALYSIS_START.toISOString()}`,
      );
    }
    if (analysisTime > this.now()) {
      throw new Error("Historical GFS analysisTime must not be in the future");
    }

    const rawVariables = expandHistoricalVariables(query.variables);
    const response = await this.source.fetch({
      analysisTime,
      latitude: query.latitude,
      longitude: query.longitude,
      variables: rawVariables.map((id) => RAW_HISTORY_VARIABLES[id].ncssName),
    });
    const parsed = parseHistoricalProfileCsv(
      response.csv,
      rawVariables,
      query.pressureLevelsHpa,
      { latitude: query.latitude, longitude: query.longitude },
    );

    for (const level of parsed.levels) {
      applyHistoricalDerivedValues(level, query.variables);
    }
    assertRequestedVariablesComplete(parsed.levels, query.variables);

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: parsed.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      levels: parsed.levels,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        dataset: response.dataset,
        cacheHit: response.cacheHit,
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
  const pressureIndex = findHeaderIndex(headers, ["vertCoord", "isobaric", "isobaric1", "isobaric2", "isobaric3", "isobaric4", "isobaric5"]);
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
    case "vertical_velocity": return level.verticalVelocityPaS !== undefined;
    case "absolute_vorticity": return level.absoluteVorticityS1 !== undefined;
    case "wind": return level.windSpeedMs !== undefined && level.windDirectionDeg !== undefined;
    case "dew_point": return level.dewPointC !== undefined;
    case "potential_temperature": return level.potentialTemperatureK !== undefined;
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
