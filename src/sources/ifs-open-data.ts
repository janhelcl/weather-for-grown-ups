import {
  parseGribIndex,
  type GribIndexEntry,
} from "@mattnucc/gribberish";

export const IFS_OPEN_DATA_BASE_URL = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com";

export interface IfsIndexSelector {
  key: string;
  param: string;
  levtype: "pl" | "sfc";
  levelist?: number;
}

export interface IfsAvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean>;
}

export function buildIfsOpenDataForecastUrl(run: Date, forecastHour: number): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const step = `${forecastHour}h`;
  return `${IFS_OPEN_DATA_BASE_URL}/${date}/${hour}z/ifs/0p25/oper/${date}${hour}0000-${step}-oper-fc.grib2`;
}

export function buildIfsOpenDataForecastIndexUrl(run: Date, forecastHour: number): string {
  return buildIfsOpenDataForecastUrl(run, forecastHour).replace(/\.grib2$/, ".index");
}

export function parseIfsOpenDataIndex(text: string): GribIndexEntry[] {
  return parseGribIndex(text);
}

export function selectIfsIndexEntries(
  entries: readonly GribIndexEntry[],
  selectors: readonly IfsIndexSelector[],
): GribIndexEntry[] {
  const selected: GribIndexEntry[] = [];
  const missing: string[] = [];

  for (const selector of selectors) {
    const match = entries.find((entry) => {
      if (entry.var !== selector.param) return false;
      if (entry.keys.levtype !== selector.levtype) return false;
      if (selector.levtype === "pl") {
        return entry.keys.levelist === String(selector.levelist);
      }
      return true;
    });
    if (!match) {
      missing.push(
        selector.levtype === "pl"
          ? `${selector.param}@${selector.levelist}hPa`
          : `${selector.param}@sfc`,
      );
      continue;
    }
    if (match.length === undefined || match.length <= 0) {
      throw new Error(`ECMWF IFS index entry for ${selector.key} has no usable byte length`);
    }
    selected.push(match);
  }

  if (missing.length > 0) {
    throw new Error(`ECMWF IFS index is missing requested fields: ${missing.join(", ")}`);
  }
  return selected;
}

export class IfsOpenDataRunProbe implements IfsAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    const url = buildIfsOpenDataForecastIndexUrl(run, forecastHour);
    const response = await this.fetchFn(url, {
      headers: { "user-agent": "weather-for-grown-ups/0.2" },
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `ECMWF IFS run discovery failed: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const entries = parseIfsOpenDataIndex(await response.text());
    try {
      selectIfsIndexEntries(entries, selectors);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ECMWF IFS index is missing requested fields:")) {
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
