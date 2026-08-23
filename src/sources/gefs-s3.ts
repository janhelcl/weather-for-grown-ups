import type { GefsMember } from "../catalog/gefs.js";

export const GEFS_S3_BASE_URL = "https://noaa-gefs-pds.s3.amazonaws.com";

export interface GefsAvailabilityProbe {
  areMembersAvailable(run: Date, forecastHour: number, members: readonly GefsMember[]): Promise<boolean>;
}

export function buildGefsS3ForecastUrl(run: Date, forecastHour: number, member: GefsMember): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const fh = forecastHour.toString().padStart(3, "0");
  const prefix = member === "c00" ? "gec00" : `ge${member}`;
  return `${GEFS_S3_BASE_URL}/gefs.${date}/${hour}/atmos/pgrb2ap5/${prefix}.t${hour}z.pgrb2a.0p50.f${fh}`;
}

export function buildGefsS3ForecastIndexUrl(run: Date, forecastHour: number, member: GefsMember): string {
  return `${buildGefsS3ForecastUrl(run, forecastHour, member)}.idx`;
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
      headers: { "user-agent": "weather-for-grown-ups/0.1" },
    });
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new Error(`GEFS run discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`);
  }
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
