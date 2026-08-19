export const GFS_S3_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const COMPLETE_RUN_MARKER_FORECAST_HOUR = 384;

export interface RunAvailabilityProbe {
  isRunComplete(run: Date): Promise<boolean>;
}

export function buildGfsS3ForecastUrl(run: Date, forecastHour: number): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const fh = forecastHour.toString().padStart(3, "0");
  return `${GFS_S3_BASE_URL}/gfs.${date}/${hour}/atmos/gfs.t${hour}z.pgrb2.0p25.f${fh}`;
}

export function buildGfsS3ForecastIndexUrl(run: Date, forecastHour: number): string {
  return `${buildGfsS3ForecastUrl(run, forecastHour)}.idx`;
}

export function buildGfsS3RunMarkerUrl(run: Date): string {
  return buildGfsS3ForecastIndexUrl(run, COMPLETE_RUN_MARKER_FORECAST_HOUR);
}

export class GfsS3RunProbe implements RunAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async isRunComplete(run: Date): Promise<boolean> {
    const url = buildGfsS3RunMarkerUrl(run);
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
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
