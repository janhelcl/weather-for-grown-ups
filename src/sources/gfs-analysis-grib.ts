import type { DecodedValue } from "../types/decoded.js";
import type { GridValuePoint } from "../grib/wgrib2-grid.js";

/**
 * Map NCSS Grid 4 analysis variable names (as requested by
 * HistoricalProfileService / HistoricalFieldsService /
 * HistoricalAreaSummaryService) onto GFS GRIB2 index selectors.
 */
export interface HistoricalNcssGribSelector {
  ncssName: string;
  gfsCode: string;
  /** Exact GRIB level string, or omit for every non-isobaric level of `gfsCode`. */
  gribLevel?: string;
  kind: "isobaric" | "surface_or_column";
}

const ISOBARIC_NCSS_TO_GFS: Readonly<Record<string, string>> = {
  Temperature_isobaric: "TMP",
  Relative_humidity_isobaric: "RH",
  "u-component_of_wind_isobaric": "UGRD",
  "v-component_of_wind_isobaric": "VGRD",
  Geopotential_height_isobaric: "HGT",
  Specific_humidity_isobaric: "SPFH",
  Vertical_velocity_pressure_isobaric: "VVEL",
  Absolute_vorticity_isobaric: "ABSV",
  Cloud_mixing_ratio_isobaric: "CLWMR",
  Ozone_Mixing_Ratio_isobaric: "O3MR",
};

const FIELD_NCSS_TO_GFS: Readonly<Record<string, { gfsCode: string; gribLevel?: string }>> = {
  Pressure_surface: { gfsCode: "PRES", gribLevel: "surface" },
  Geopotential_height_surface: { gfsCode: "HGT", gribLevel: "surface" },
  Temperature_surface: { gfsCode: "TMP", gribLevel: "surface" },
  Convective_available_potential_energy_surface: { gfsCode: "CAPE", gribLevel: "surface" },
  Convective_inhibition_surface: { gfsCode: "CIN", gribLevel: "surface" },
  Temperature_height_above_ground: { gfsCode: "TMP" },
  Relative_humidity_height_above_ground: { gfsCode: "RH" },
  Specific_humidity_height_above_ground: { gfsCode: "SPFH" },
  Dewpoint_temperature_height_above_ground: { gfsCode: "DPT" },
  "u-component_of_wind_height_above_ground": { gfsCode: "UGRD" },
  "v-component_of_wind_height_above_ground": { gfsCode: "VGRD" },
  Pressure_height_above_ground: { gfsCode: "PRES" },
  Precipitable_water_entire_atmosphere_single_layer: {
    gfsCode: "PWAT",
    gribLevel: "entire atmosphere (considered as a single layer)",
  },
  Cloud_water_entire_atmosphere_single_layer: {
    gfsCode: "CWAT",
    gribLevel: "entire atmosphere (considered as a single layer)",
  },
  Relative_humidity_entire_atmosphere_single_layer: {
    gfsCode: "RH",
    gribLevel: "entire atmosphere (considered as a single layer)",
  },
  Total_ozone_entire_atmosphere_single_layer: {
    gfsCode: "TOZNE",
    gribLevel: "entire atmosphere (considered as a single layer)",
  },
};

export function historicalNcssSelectors(
  ncssNames: readonly string[],
): HistoricalNcssGribSelector[] {
  return ncssNames.map((ncssName) => {
    const isobaric = ISOBARIC_NCSS_TO_GFS[ncssName];
    if (isobaric !== undefined) {
      return { ncssName, gfsCode: isobaric, kind: "isobaric" };
    }
    const field = FIELD_NCSS_TO_GFS[ncssName];
    if (field === undefined) {
      throw new Error(`No GFS GRIB mapping for historical NCSS variable ${ncssName}`);
    }
    return {
      ncssName,
      gfsCode: field.gfsCode,
      ...(field.gribLevel === undefined ? {} : { gribLevel: field.gribLevel }),
      kind: "surface_or_column",
    };
  });
}

export interface HistoricalPointCsvRow {
  latitude: number;
  longitude: number;
  /** Pressure in Pa when the row is isobaric; otherwise undefined. */
  pressurePa?: number;
  /** Height above ground in metres when the row is a HAG field. */
  heightAboveGroundM?: number;
  values: Readonly<Record<string, number>>;
}

/**
 * Build an NCSS-shaped point CSV that the historical parsers accept. Headers
 * keep the optional `[unit=...]` suffix the parsers strip, and pressure is
 * emitted in Pa so the Pa→hPa conversion path stays exercised.
 */
export function formatHistoricalPointCsv(rows: readonly HistoricalPointCsvRow[]): string {
  if (rows.length === 0) throw new Error("Cannot format an empty historical analysis CSV");
  const ncssNames = [...new Set(rows.flatMap((row) => Object.keys(row.values)))].sort();
  const hasPressure = rows.some((row) => row.pressurePa !== undefined);
  const hasHeight = rows.some((row) => row.heightAboveGroundM !== undefined);
  const headers = [
    "latitude",
    "longitude",
    ...(hasPressure ? ['vertCoord[unit="Pa"]'] : []),
    ...(hasHeight ? ['height_above_ground[unit="m"]'] : []),
    ...ncssNames.map((name) => `${name}[unit="1"]`),
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const cells = [
      String(row.latitude),
      String(row.longitude),
      ...(hasPressure ? [row.pressurePa === undefined ? "" : String(row.pressurePa)] : []),
      ...(hasHeight ? [row.heightAboveGroundM === undefined ? "" : String(row.heightAboveGroundM)] : []),
      ...ncssNames.map((name) => {
        const value = row.values[name];
        return value === undefined || !Number.isFinite(value) ? "" : String(value);
      }),
    ];
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build an NCSS-shaped area CSV for one variable. Area summary requests one
 * NCSS name at a time; pressure/height columns are included when provided.
 */
export function formatHistoricalAreaCsv(
  ncssName: string,
  points: readonly GridValuePoint[],
  options: { pressurePa?: number; heightAboveGroundM?: number } = {},
): string {
  if (points.length === 0) throw new Error("Cannot format an empty historical area CSV");
  const hasPressure = options.pressurePa !== undefined;
  const hasHeight = options.heightAboveGroundM !== undefined;
  const headers = [
    "latitude",
    "longitude",
    ...(hasPressure ? ['isobaric[unit="Pa"]'] : []),
    ...(hasHeight ? ['height_above_ground[unit="m"]'] : []),
    `${ncssName}[unit="1"]`,
  ];
  const lines = [headers.join(",")];
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    lines.push([
      String(point.latitude),
      String(point.longitude),
      ...(hasPressure ? [String(options.pressurePa)] : []),
      ...(hasHeight ? [String(options.heightAboveGroundM)] : []),
      String(point.value),
    ].join(","));
  }
  if (lines.length === 1) throw new Error("Historical area CSV has no defined grid points");
  return `${lines.join("\n")}\n`;
}

/** Match a decoded GRIB point value to an NCSS name via code + vertical. */
export function ncssNameForDecodedValue(
  value: DecodedValue,
  selectors: readonly HistoricalNcssGribSelector[],
): string | undefined {
  for (const selector of selectors) {
    if (value.code !== selector.gfsCode) continue;
    if (selector.kind === "isobaric") {
      if (value.pressureHpa !== undefined) return selector.ncssName;
      continue;
    }
    if (selector.gribLevel === "surface") {
      if (value.surface) return selector.ncssName;
      continue;
    }
    if (selector.gribLevel?.includes("entire atmosphere")) {
      if (value.namedVertical?.includes("entire atmosphere") || value.namedVertical === "entire atmosphere") {
        return selector.ncssName;
      }
      // Bundled decoder may surface PWAT/CWAT/TOZNE without a namedVertical.
      if (value.pressureHpa === undefined && value.heightAboveGroundM === undefined && !value.surface) {
        return selector.ncssName;
      }
      continue;
    }
    if (selector.gribLevel !== undefined) {
      const height = heightMetresFromGribLevel(selector.gribLevel);
      if (height !== undefined && value.heightAboveGroundM === height) return selector.ncssName;
      continue;
    }
    // Shared NCSS names that span multiple heights: any non-isobaric match.
    if (value.pressureHpa === undefined) return selector.ncssName;
  }
  return undefined;
}

export function heightMetresFromGribLevel(level: string | undefined): number | undefined {
  if (level === undefined) return undefined;
  const match = level.match(/^(\d+(?:\.\d+)?) m above ground$/i);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function rowsFromDecodedPointValues(
  values: readonly DecodedValue[],
  selectors: readonly HistoricalNcssGribSelector[],
): HistoricalPointCsvRow[] {
  const rows = new Map<string, HistoricalPointCsvRow>();
  for (const value of values) {
    const ncssName = ncssNameForDecodedValue(value, selectors);
    if (ncssName === undefined || !Number.isFinite(value.value)) continue;
    const key = [
      value.gridPoint.latitude,
      value.gridPoint.longitude,
      value.pressureHpa ?? "",
      value.heightAboveGroundM ?? "",
    ].join("\0");
    const row = rows.get(key) ?? {
      latitude: value.gridPoint.latitude,
      longitude: value.gridPoint.longitude,
      ...(value.pressureHpa === undefined ? {} : { pressurePa: value.pressureHpa * 100 }),
      ...(value.heightAboveGroundM === undefined ? {} : { heightAboveGroundM: value.heightAboveGroundM }),
      values: {},
    };
    rows.set(key, {
      ...row,
      values: { ...row.values, [ncssName]: value.value },
    });
  }
  return [...rows.values()].sort((left, right) =>
    (right.pressurePa ?? 0) - (left.pressurePa ?? 0)
    || (left.heightAboveGroundM ?? 0) - (right.heightAboveGroundM ?? 0));
}
