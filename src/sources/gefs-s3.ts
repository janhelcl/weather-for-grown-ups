import { upstreamHttpFailure } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import type { GefsMember } from "../catalog/gefs.js";

export const GEFS_S3_BASE_URL = "https://noaa-gefs-pds.s3.amazonaws.com";
export const GEFS_0P25_SURFACE_MAX_FORECAST_HOUR = 240;

export type GefsAtmosProduct = "pgrb2a_0p50" | "pgrb2s_0p25";

export function gefsAtmosProductForSelection(
  hasPressureSelection: boolean,
  forecastHour: number,
): GefsAtmosProduct {
  return !hasPressureSelection && forecastHour <= GEFS_0P25_SURFACE_MAX_FORECAST_HOUR
    ? "pgrb2s_0p25"
    : "pgrb2a_0p50";
}

export function gefsAtmosProductGridDegrees(product: GefsAtmosProduct): 0.25 | 0.5 {
  return product === "pgrb2s_0p25" ? 0.25 : 0.5;
}

export interface GefsAvailabilityProbe {
  areMembersAvailable(run: Date, forecastHour: number, members: readonly GefsMember[]): Promise<boolean>;
}

export function buildGefsS3ForecastUrl(
  run: Date,
  forecastHour: number,
  member: GefsMember,
  product: GefsAtmosProduct = "pgrb2a_0p50",
): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const fh = forecastHour.toString().padStart(3, "0");
  const prefix = member === "c00" ? "gec00" : `ge${member}`;
  const path = product === "pgrb2s_0p25" ? "pgrb2sp25" : "pgrb2ap5";
  const suffix = product === "pgrb2s_0p25" ? "pgrb2s.0p25" : "pgrb2a.0p50";
  return `${GEFS_S3_BASE_URL}/gefs.${date}/${hour}/atmos/${path}/${prefix}.t${hour}z.${suffix}.f${fh}`;
}

export function buildGefsS3ForecastIndexUrl(
  run: Date,
  forecastHour: number,
  member: GefsMember,
  product: GefsAtmosProduct = "pgrb2a_0p50",
): string {
  return `${buildGefsS3ForecastUrl(run, forecastHour, member, product)}.idx`;
}

export class GefsS3RunProbe implements GefsAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async areMembersAvailable(run: Date, forecastHour: number, members: readonly GefsMember[]): Promise<boolean> {
    const availability = await Promise.all(members.map((member) => this.isAvailable(
      buildGefsS3ForecastIndexUrl(run, forecastHour, member),
    )));
    return availability.every(Boolean);
  }

  private async isAvailable(url: string): Promise<boolean> {
    const response = await this.fetchFn(url, {
      method: "HEAD",
      headers: { "user-agent": WFG_USER_AGENT },
    });
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw upstreamHttpFailure({
      provider: "NOAA AWS Open Data",
      operation: "GEFS run discovery request",
      status: response.status,
      statusText: response.statusText,
      url,
    });
  }
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
