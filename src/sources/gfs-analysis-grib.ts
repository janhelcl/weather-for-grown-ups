import type { DecodedValue } from "../types/decoded.js";
import type {
  HistoricalAnalysisPointRow,
  HistoricalAnalysisVariableId,
} from "./gfs-analysis.js";

export interface HistoricalAnalysisSelector {
  id: HistoricalAnalysisVariableId;
  gfsCode: string;
  /** Exact GRIB level string, or omit for the variable's non-isobaric column. */
  gribLevel?: string;
  kind: "isobaric" | "surface_or_column";
}

const SELECTORS: Record<HistoricalAnalysisVariableId, HistoricalAnalysisSelector> = {
  temperature: isobaric("temperature", "TMP"),
  relative_humidity: isobaric("relative_humidity", "RH"),
  u_wind: isobaric("u_wind", "UGRD"),
  v_wind: isobaric("v_wind", "VGRD"),
  geopotential_height: isobaric("geopotential_height", "HGT"),
  specific_humidity: isobaric("specific_humidity", "SPFH"),
  vertical_velocity: isobaric("vertical_velocity", "VVEL"),
  absolute_vorticity: isobaric("absolute_vorticity", "ABSV"),
  cloud_water_mixing_ratio: isobaric("cloud_water_mixing_ratio", "CLWMR"),
  ozone_mixing_ratio: isobaric("ozone_mixing_ratio", "O3MR"),
  surface_pressure: named("surface_pressure", "PRES", "surface"),
  surface_geopotential_height: named("surface_geopotential_height", "HGT", "surface"),
  surface_temperature: named("surface_temperature", "TMP", "surface"),
  surface_cape: named("surface_cape", "CAPE", "surface"),
  surface_cin: named("surface_cin", "CIN", "surface"),
  temperature_2m: named("temperature_2m", "TMP", "2 m above ground"),
  relative_humidity_2m: named("relative_humidity_2m", "RH", "2 m above ground"),
  specific_humidity_2m: named("specific_humidity_2m", "SPFH", "2 m above ground"),
  dew_point_2m: named("dew_point_2m", "DPT", "2 m above ground"),
  u_wind_10m: named("u_wind_10m", "UGRD", "10 m above ground"),
  v_wind_10m: named("v_wind_10m", "VGRD", "10 m above ground"),
  temperature_80m: named("temperature_80m", "TMP", "80 m above ground"),
  specific_humidity_80m: named("specific_humidity_80m", "SPFH", "80 m above ground"),
  pressure_80m: named("pressure_80m", "PRES", "80 m above ground"),
  u_wind_80m: named("u_wind_80m", "UGRD", "80 m above ground"),
  v_wind_80m: named("v_wind_80m", "VGRD", "80 m above ground"),
  temperature_100m: named("temperature_100m", "TMP", "100 m above ground"),
  u_wind_100m: named("u_wind_100m", "UGRD", "100 m above ground"),
  v_wind_100m: named("v_wind_100m", "VGRD", "100 m above ground"),
  precipitable_water: named(
    "precipitable_water",
    "PWAT",
    "entire atmosphere (considered as a single layer)",
  ),
  total_column_cloud_water: named(
    "total_column_cloud_water",
    "CWAT",
    "entire atmosphere (considered as a single layer)",
  ),
  column_relative_humidity: named(
    "column_relative_humidity",
    "RH",
    "entire atmosphere (considered as a single layer)",
  ),
  total_column_ozone: named(
    "total_column_ozone",
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
  gfsCode: string,
): HistoricalAnalysisSelector {
  return { id, gfsCode, kind: "isobaric" };
}

function named(
  id: HistoricalAnalysisVariableId,
  gfsCode: string,
  gribLevel: string,
): HistoricalAnalysisSelector {
  return { id, gfsCode, gribLevel, kind: "surface_or_column" };
}

function normalizeLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
}
