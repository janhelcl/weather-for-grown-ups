import type { GridValuePoint } from "../grib/wgrib2-grid.js";
import type { DecodedValue } from "../types/decoded.js";
import type {
  HistoricalAnalysisPointRow,
  HistoricalAnalysisVariableId,
} from "./gfs-analysis.js";

export interface HistoricalAnalysisSelector {
  id: HistoricalAnalysisVariableId;
  ncssName: string;
  gfsCode: string;
  /** Exact GRIB level string, or omit for the variable's non-isobaric column. */
  gribLevel?: string;
  kind: "isobaric" | "surface_or_column";
}

const SELECTORS: Record<HistoricalAnalysisVariableId, HistoricalAnalysisSelector> = {
  temperature: isobaric("temperature", "Temperature_isobaric", "TMP"),
  relative_humidity: isobaric("relative_humidity", "Relative_humidity_isobaric", "RH"),
  u_wind: isobaric("u_wind", "u-component_of_wind_isobaric", "UGRD"),
  v_wind: isobaric("v_wind", "v-component_of_wind_isobaric", "VGRD"),
  geopotential_height: isobaric("geopotential_height", "Geopotential_height_isobaric", "HGT"),
  specific_humidity: isobaric("specific_humidity", "Specific_humidity_isobaric", "SPFH"),
  vertical_velocity: isobaric("vertical_velocity", "Vertical_velocity_pressure_isobaric", "VVEL"),
  absolute_vorticity: isobaric("absolute_vorticity", "Absolute_vorticity_isobaric", "ABSV"),
  cloud_water_mixing_ratio: isobaric("cloud_water_mixing_ratio", "Cloud_mixing_ratio_isobaric", "CLWMR"),
  ozone_mixing_ratio: isobaric("ozone_mixing_ratio", "Ozone_Mixing_Ratio_isobaric", "O3MR"),
  surface_pressure: named("surface_pressure", "Pressure_surface", "PRES", "surface"),
  surface_geopotential_height: named("surface_geopotential_height", "Geopotential_height_surface", "HGT", "surface"),
  surface_temperature: named("surface_temperature", "Temperature_surface", "TMP", "surface"),
  surface_cape: named("surface_cape", "Convective_available_potential_energy_surface", "CAPE", "surface"),
  surface_cin: named("surface_cin", "Convective_inhibition_surface", "CIN", "surface"),
  temperature_2m: named("temperature_2m", "Temperature_height_above_ground", "TMP", "2 m above ground"),
  relative_humidity_2m: named("relative_humidity_2m", "Relative_humidity_height_above_ground", "RH", "2 m above ground"),
  specific_humidity_2m: named("specific_humidity_2m", "Specific_humidity_height_above_ground", "SPFH", "2 m above ground"),
  dew_point_2m: named("dew_point_2m", "Dewpoint_temperature_height_above_ground", "DPT", "2 m above ground"),
  u_wind_10m: named("u_wind_10m", "u-component_of_wind_height_above_ground", "UGRD", "10 m above ground"),
  v_wind_10m: named("v_wind_10m", "v-component_of_wind_height_above_ground", "VGRD", "10 m above ground"),
  temperature_80m: named("temperature_80m", "Temperature_height_above_ground", "TMP", "80 m above ground"),
  specific_humidity_80m: named("specific_humidity_80m", "Specific_humidity_height_above_ground", "SPFH", "80 m above ground"),
  pressure_80m: named("pressure_80m", "Pressure_height_above_ground", "PRES", "80 m above ground"),
  u_wind_80m: named("u_wind_80m", "u-component_of_wind_height_above_ground", "UGRD", "80 m above ground"),
  v_wind_80m: named("v_wind_80m", "v-component_of_wind_height_above_ground", "VGRD", "80 m above ground"),
  temperature_100m: named("temperature_100m", "Temperature_height_above_ground", "TMP", "100 m above ground"),
  u_wind_100m: named("u_wind_100m", "u-component_of_wind_height_above_ground", "UGRD", "100 m above ground"),
  v_wind_100m: named("v_wind_100m", "v-component_of_wind_height_above_ground", "VGRD", "100 m above ground"),
  precipitable_water: named(
    "precipitable_water",
    "Precipitable_water_entire_atmosphere_single_layer",
    "PWAT",
    "entire atmosphere (considered as a single layer)",
  ),
  total_column_cloud_water: named(
    "total_column_cloud_water",
    "Cloud_water_entire_atmosphere_single_layer",
    "CWAT",
    "entire atmosphere (considered as a single layer)",
  ),
  column_relative_humidity: named(
    "column_relative_humidity",
    "Relative_humidity_entire_atmosphere_single_layer",
    "RH",
    "entire atmosphere (considered as a single layer)",
  ),
  total_column_ozone: named(
    "total_column_ozone",
    "Total_ozone_entire_atmosphere_single_layer",
    "TOZNE",
    "entire atmosphere (considered as a single layer)",
  ),
};

export function historicalAnalysisSelectors(
  ids: readonly HistoricalAnalysisVariableId[],
): HistoricalAnalysisSelector[] {
  return ids.map((id) => SELECTORS[id]);
}

export function historicalAnalysisSelector(id: HistoricalAnalysisVariableId): HistoricalAnalysisSelector {
  return SELECTORS[id];
}

export function ncssNamesForHistoricalAnalysisVariables(
  ids: readonly HistoricalAnalysisVariableId[],
): string[] {
  return [...new Set(historicalAnalysisSelectors(ids).map((selector) => selector.ncssName))];
}

export function parseHistoricalNcssPointCsv(
  csv: string,
  ids: readonly HistoricalAnalysisVariableId[],
  requestedPoint: { latitude: number; longitude: number },
): HistoricalAnalysisPointRow[] {
  const selectors = historicalAnalysisSelectors(ids);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Historical NCSS response contains no data rows");

  const rawHeaders = parseCsvLine(lines[0]!);
  const headers = rawHeaders.map(normalizeHeader);
  const pressureIndex = findPressureCoordinate(headers);
  const pressureInPa = pressureIndex >= 0
    && /\[unit\s*=\s*"?Pa"?\]/i.test(rawHeaders[pressureIndex] ?? "");
  const heightIndex = headers.findIndex((header) =>
    header.startsWith("height_above_ground") || header === "alt");
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const columns = new Map<HistoricalAnalysisVariableId, number>();
  for (const selector of selectors) {
    const index = findHeaderIndex(headers, ncssAliases(selector.ncssName));
    if (index < 0) {
      throw new Error(`Historical NCSS response is missing variable ${selector.ncssName}`);
    }
    columns.set(selector.id, index);
  }

  const rows: HistoricalAnalysisPointRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const rawPressure = pressureIndex < 0 ? undefined : numericCell(cells[pressureIndex]);
    const pressureHpa = rawPressure === undefined
      ? undefined
      : pressureInPa || rawPressure > 2_000 ? rawPressure / 100 : rawPressure;
    const heightAboveGroundM = heightIndex < 0 ? undefined : numericCell(cells[heightIndex]);
    const latitude = latitudeIndex < 0 ? requestedPoint.latitude : numericCell(cells[latitudeIndex]) ?? requestedPoint.latitude;
    const rawLongitude = longitudeIndex < 0 ? requestedPoint.longitude : numericCell(cells[longitudeIndex]) ?? requestedPoint.longitude;
    const values: Partial<Record<HistoricalAnalysisVariableId, number>> = {};
    for (const selector of selectors) {
      if (!selectorMatchesCoordinate(selector, pressureHpa, heightAboveGroundM)) continue;
      const column = columns.get(selector.id)!;
      const value = numericCell(cells[column]);
      if (value !== undefined) values[selector.id] = value;
    }
    if (Object.keys(values).length === 0) continue;
    rows.push({
      latitude,
      longitude: normalizeLongitude(rawLongitude),
      ...(pressureHpa === undefined ? {} : { pressureHpa }),
      ...(heightAboveGroundM === undefined ? {} : { heightAboveGroundM }),
      values,
    });
  }
  if (rows.length === 0) throw new Error("Historical NCSS response contains no requested values");
  return rows;
}

export function parseHistoricalNcssAreaCsv(
  csv: string,
  id: HistoricalAnalysisVariableId,
  expectedVerticalCoordinate?: number,
): GridValuePoint[] {
  const selector = historicalAnalysisSelector(id);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Historical NCSS area response contains no data rows");
  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const variableIndex = findHeaderIndex(headers, ncssAliases(selector.ncssName));
  if (latitudeIndex < 0 || longitudeIndex < 0 || variableIndex < 0) {
    throw new Error(`Historical NCSS area response is missing coordinates or ${selector.ncssName}`);
  }
  const verticalIndex = expectedVerticalCoordinate === undefined
    ? -1
    : headers.findIndex((header) =>
        header.startsWith("isobaric")
        || header.startsWith("height_above_ground")
        || header === "vertCoord"
        || header === "alt");
  const rawHeader = verticalIndex < 0 ? "" : parseCsvLine(lines[0]!)[verticalIndex] ?? "";
  const verticalInPa = /\[unit\s*=\s*"?Pa"?\]/i.test(rawHeader);
  const points: GridValuePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (expectedVerticalCoordinate !== undefined && verticalIndex >= 0) {
      const rawVertical = numericCell(cells[verticalIndex]);
      const returned = rawVertical === undefined
        ? undefined
        : selector.kind === "isobaric" && !verticalInPa && rawVertical <= 2_000
          ? rawVertical * 100
          : rawVertical;
      if (returned !== undefined && Math.abs(returned - expectedVerticalCoordinate) > 1e-6) continue;
    }
    const latitude = numericCell(cells[latitudeIndex]);
    const longitude = numericCell(cells[longitudeIndex]);
    const value = numericCell(cells[variableIndex]);
    if (latitude === undefined || longitude === undefined || value === undefined) continue;
    points.push({ latitude, longitude: normalizeLongitude(longitude), value });
  }
  if (points.length === 0) throw new Error(`Historical NCSS area response contains no values for ${id}`);
  return points;
}

export function rowsFromDecodedPointValues(
  values: readonly DecodedValue[],
  selectors: readonly HistoricalAnalysisSelector[],
): HistoricalAnalysisPointRow[] {
  const rows = new Map<string, HistoricalAnalysisPointRow>();
  for (const value of values) {
    const id = idForDecodedValue(value, selectors);
    if (id === undefined || !Number.isFinite(value.value)) continue;
    const key = [
      value.gridPoint.latitude,
      value.gridPoint.longitude,
      value.pressureHpa ?? "",
      value.heightAboveGroundM ?? "",
    ].join("\0");
    const row = rows.get(key) ?? {
      latitude: value.gridPoint.latitude,
      longitude: normalizeLongitude(value.gridPoint.longitude),
      ...(value.pressureHpa === undefined ? {} : { pressureHpa: value.pressureHpa }),
      ...(value.heightAboveGroundM === undefined ? {} : { heightAboveGroundM: value.heightAboveGroundM }),
      values: {},
    };
    rows.set(key, { ...row, values: { ...row.values, [id]: value.value } });
  }
  return [...rows.values()].sort((left, right) =>
    (right.pressureHpa ?? 0) - (left.pressureHpa ?? 0)
    || (left.heightAboveGroundM ?? 0) - (right.heightAboveGroundM ?? 0));
}

export function idForDecodedValue(
  value: DecodedValue,
  selectors: readonly HistoricalAnalysisSelector[],
): HistoricalAnalysisVariableId | undefined {
  for (const selector of selectors) {
    if (value.code !== selector.gfsCode) continue;
    if (selector.kind === "isobaric") {
      if (value.pressureHpa !== undefined) return selector.id;
      continue;
    }
    if (selector.gribLevel === "surface") {
      if (value.surface) return selector.id;
      continue;
    }
    const height = heightMetresFromGribLevel(selector.gribLevel);
    if (height !== undefined) {
      if (value.heightAboveGroundM === height) return selector.id;
      continue;
    }
    if (selector.gribLevel?.includes("entire atmosphere")) {
      if (value.namedVertical?.includes("entire atmosphere")) return selector.id;
      if (value.pressureHpa === undefined && value.heightAboveGroundM === undefined && !value.surface) {
        return selector.id;
      }
    }
  }
  return undefined;
}

export function heightMetresFromGribLevel(level: string | undefined): number | undefined {
  if (level === undefined) return undefined;
  const match = level.match(/^(\d+(?:\.\d+)?) m above ground$/i);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function isobaric(
  id: HistoricalAnalysisVariableId,
  ncssName: string,
  gfsCode: string,
): HistoricalAnalysisSelector {
  return { id, ncssName, gfsCode, kind: "isobaric" };
}

function named(
  id: HistoricalAnalysisVariableId,
  ncssName: string,
  gfsCode: string,
  gribLevel: string,
): HistoricalAnalysisSelector {
  return { id, ncssName, gfsCode, gribLevel, kind: "surface_or_column" };
}

function selectorMatchesCoordinate(
  selector: HistoricalAnalysisSelector,
  pressureHpa: number | undefined,
  heightAboveGroundM: number | undefined,
): boolean {
  if (selector.kind === "isobaric") return pressureHpa !== undefined;
  const height = heightMetresFromGribLevel(selector.gribLevel);
  if (height !== undefined) return heightAboveGroundM === height;
  return pressureHpa === undefined && heightAboveGroundM === undefined;
}

function findPressureCoordinate(headers: readonly string[]): number {
  return headers.findIndex((header) =>
    header === "vertCoord" || header === "alt" || header.startsWith("isobaric"));
}

function ncssAliases(name: string): string[] {
  return name.startsWith("u-component") || name.startsWith("v-component")
    ? [name, name.replace("-component", "component")]
    : [name];
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

function normalizeLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
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
