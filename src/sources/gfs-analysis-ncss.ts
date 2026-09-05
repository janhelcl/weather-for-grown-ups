import type { GridValuePoint } from "../grib/wgrib2-grid.js";
import type {
  HistoricalAnalysisPointRow,
  HistoricalAnalysisVariableId,
} from "./gfs-analysis.js";
import {
  heightMetresFromGribLevel,
  historicalAnalysisSelector,
  historicalAnalysisSelectors,
  type HistoricalAnalysisSelector,
} from "./gfs-analysis-grib.js";

/**
 * NCSS transport mapping shared by the NCEI Grid 4 analysis source and the
 * archived GFS/GDEX NCSS adapters. Provider column names and CSV parsing stay
 * here; GRIB-backed sources only depend on canonical WFG IDs and GRIB selectors.
 */
const NCSS_NAMES: Record<HistoricalAnalysisVariableId, string> = {
  temperature: "Temperature_isobaric",
  relative_humidity: "Relative_humidity_isobaric",
  u_wind: "u-component_of_wind_isobaric",
  v_wind: "v-component_of_wind_isobaric",
  geopotential_height: "Geopotential_height_isobaric",
  specific_humidity: "Specific_humidity_isobaric",
  vertical_velocity: "Vertical_velocity_pressure_isobaric",
  absolute_vorticity: "Absolute_vorticity_isobaric",
  cloud_water_mixing_ratio: "Cloud_mixing_ratio_isobaric",
  ozone_mixing_ratio: "Ozone_Mixing_Ratio_isobaric",
  surface_pressure: "Pressure_surface",
  surface_geopotential_height: "Geopotential_height_surface",
  surface_temperature: "Temperature_surface",
  surface_cape: "Convective_available_potential_energy_surface",
  surface_cin: "Convective_inhibition_surface",
  temperature_2m: "Temperature_height_above_ground",
  relative_humidity_2m: "Relative_humidity_height_above_ground",
  specific_humidity_2m: "Specific_humidity_height_above_ground",
  dew_point_2m: "Dewpoint_temperature_height_above_ground",
  u_wind_10m: "u-component_of_wind_height_above_ground",
  v_wind_10m: "v-component_of_wind_height_above_ground",
  temperature_80m: "Temperature_height_above_ground",
  specific_humidity_80m: "Specific_humidity_height_above_ground",
  pressure_80m: "Pressure_height_above_ground",
  u_wind_80m: "u-component_of_wind_height_above_ground",
  v_wind_80m: "v-component_of_wind_height_above_ground",
  temperature_100m: "Temperature_height_above_ground",
  u_wind_100m: "u-component_of_wind_height_above_ground",
  v_wind_100m: "v-component_of_wind_height_above_ground",
  precipitable_water: "Precipitable_water_entire_atmosphere_single_layer",
  total_column_cloud_water: "Cloud_water_entire_atmosphere_single_layer",
  column_relative_humidity: "Relative_humidity_entire_atmosphere_single_layer",
  total_column_ozone: "Total_ozone_entire_atmosphere_single_layer",
};

export function ncssNameForHistoricalAnalysisVariable(id: HistoricalAnalysisVariableId): string {
  return NCSS_NAMES[id];
}

export function ncssNamesForHistoricalAnalysisVariables(
  ids: readonly HistoricalAnalysisVariableId[],
): string[] {
  return [...new Set(ids.map(ncssNameForHistoricalAnalysisVariable))];
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
  const pressureIndex = findPressureCoordinate(headers, rawHeaders, selectors);
  const pressureInPa = pressureIndex >= 0 && hasPressureUnit(rawHeaders[pressureIndex] ?? "", "Pa");
  const heightIndex = findHeightCoordinate(headers, rawHeaders, selectors);
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const columns = new Map<HistoricalAnalysisVariableId, number>();
  for (const selector of selectors) {
    const ncssName = ncssNameForHistoricalAnalysisVariable(selector.id);
    const index = findHeaderIndex(headers, ncssAliases(ncssName));
    if (index < 0) {
      throw new Error(`Historical NCSS response is missing variable ${ncssName}`);
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
    const latitude = latitudeIndex < 0
      ? requestedPoint.latitude
      : numericCell(cells[latitudeIndex]) ?? requestedPoint.latitude;
    const rawLongitude = longitudeIndex < 0
      ? requestedPoint.longitude
      : numericCell(cells[longitudeIndex]) ?? requestedPoint.longitude;
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
  const ncssName = ncssNameForHistoricalAnalysisVariable(id);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Historical NCSS area response contains no data rows");

  const rawHeaders = parseCsvLine(lines[0]!);
  const headers = rawHeaders.map(normalizeHeader);
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const variableIndex = findHeaderIndex(headers, ncssAliases(ncssName));
  if (latitudeIndex < 0 || longitudeIndex < 0 || variableIndex < 0) {
    throw new Error(`Historical NCSS area response is missing coordinates or ${ncssName}`);
  }
  const verticalIndex = expectedVerticalCoordinate === undefined
    ? -1
    : findAreaVerticalCoordinate(headers, rawHeaders, selector);
  const rawVerticalHeader = verticalIndex < 0 ? "" : rawHeaders[verticalIndex] ?? "";
  const verticalInPa = hasPressureUnit(rawVerticalHeader, "Pa");
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

function findPressureCoordinate(
  headers: readonly string[],
  rawHeaders: readonly string[],
  selectors: readonly HistoricalAnalysisSelector[],
): number {
  const explicit = headers.findIndex((header) => header === "vertCoord" || header.startsWith("isobaric"));
  if (explicit >= 0) return explicit;
  const alt = headers.indexOf("alt");
  if (alt < 0) return -1;
  const raw = rawHeaders[alt] ?? "";
  if (hasAnyPressureUnit(raw)) return alt;
  if (hasLengthUnit(raw)) return -1;
  return selectors.every((selector) => selector.kind === "isobaric") ? alt : -1;
}

function findHeightCoordinate(
  headers: readonly string[],
  rawHeaders: readonly string[],
  selectors: readonly HistoricalAnalysisSelector[],
): number {
  const explicit = headers.findIndex((header) => header.startsWith("height_above_ground"));
  if (explicit >= 0) return explicit;
  const alt = headers.indexOf("alt");
  if (alt < 0) return -1;
  const raw = rawHeaders[alt] ?? "";
  if (hasLengthUnit(raw)) return alt;
  if (hasAnyPressureUnit(raw)) return -1;
  return selectors.every((selector) => heightMetresFromGribLevel(selector.gribLevel) !== undefined) ? alt : -1;
}

function findAreaVerticalCoordinate(
  headers: readonly string[],
  rawHeaders: readonly string[],
  selector: HistoricalAnalysisSelector,
): number {
  const explicit = headers.findIndex((header) =>
    header.startsWith("isobaric")
    || header.startsWith("height_above_ground")
    || header === "vertCoord");
  if (explicit >= 0) return explicit;
  const alt = headers.indexOf("alt");
  if (alt < 0) return -1;
  const raw = rawHeaders[alt] ?? "";
  if (selector.kind === "isobaric") return hasLengthUnit(raw) ? -1 : alt;
  const height = heightMetresFromGribLevel(selector.gribLevel);
  if (height !== undefined) return hasAnyPressureUnit(raw) ? -1 : alt;
  return -1;
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

function hasPressureUnit(header: string, unit: "Pa" | "hPa"): boolean {
  return new RegExp(`\\[unit\\s*=\\s*"?${unit}"?\\]`, "i").test(header);
}

function hasAnyPressureUnit(header: string): boolean {
  return hasPressureUnit(header, "Pa")
    || hasPressureUnit(header, "hPa")
    || /\[unit\s*=\s*"?(?:mb|mbar)"?\]/i.test(header);
}

function hasLengthUnit(header: string): boolean {
  return /\[unit\s*=\s*"?(?:m|meter|metre|meters|metres)"?\]/i.test(header);
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
