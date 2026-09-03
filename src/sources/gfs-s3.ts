import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { GfsGrid } from "../catalog/gfs-grid.js";
import {
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
} from "../grib/index.js";

export const GFS_S3_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const COMPLETE_RUN_MARKER_FORECAST_HOUR = 384;

export interface ForecastAvailabilitySelection {
  variableCodes: readonly string[];
  pressureLevelsHpa: readonly number[];
  fields: readonly RawNonIsobaricFieldDefinition[];
}

export interface RunAvailabilityProbe {
  isRunComplete(run: Date, grid?: GfsGrid): Promise<boolean>;
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selection: ForecastAvailabilitySelection,
    grid?: GfsGrid,
  ): Promise<boolean>;
}

export function buildGfsS3ForecastUrl(run: Date, forecastHour: number, grid: GfsGrid = "0p25"): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const fh = forecastHour.toString().padStart(3, "0");
  return `${GFS_S3_BASE_URL}/gfs.${date}/${hour}/atmos/gfs.t${hour}z.pgrb2.${grid}.f${fh}`;
}

export function buildGfsS3ForecastIndexUrl(run: Date, forecastHour: number, grid: GfsGrid = "0p25"): string {
  return `${buildGfsS3ForecastUrl(run, forecastHour, grid)}.idx`;
}

export function buildGfsS3RunMarkerUrl(run: Date, grid: GfsGrid = "0p25"): string {
  return buildGfsS3ForecastIndexUrl(run, COMPLETE_RUN_MARKER_FORECAST_HOUR, grid);
}

export class GfsS3RunProbe implements RunAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async isRunComplete(run: Date, grid: GfsGrid = "0p25"): Promise<boolean> {
    const url = buildGfsS3RunMarkerUrl(run, grid);
    const response = await this.fetchFn(url, {
      method: "HEAD",
      headers: { "user-agent": "weather-for-grown-ups/0.1" },
    });

    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new Error(
      `GFS run discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selection: ForecastAvailabilitySelection,
    grid: GfsGrid = "0p25",
  ): Promise<boolean> {
    const url = buildGfsS3ForecastIndexUrl(run, forecastHour, grid);
    const response = await this.fetchFn(url, {
      headers: { "user-agent": "weather-for-grown-ups/0.1" },
    });

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `GFS forecast discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }

    const records = parseGribIndex(await response.text());
    try {
      selectPressureByteRanges(records, selection.variableCodes, selection.pressureLevelsHpa);
      selectNonIsobaricByteRanges(records, selection.fields);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("GFS index is missing requested fields:")) {
        return false;
      }
      throw error;
    }
  }
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
