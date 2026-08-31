import { isRetryableHttpStatus } from "../access/http-retry.js";
import {
  IFS_OPEN_DATA_MIRRORS,
  parseIfsOpenDataIndex,
  runIfsHttpWithRetry,
  selectIfsIndexEntries,
  type IfsHttpAccessPolicy,
  type IfsIndexSelector,
} from "./ifs-open-data.js";

export const AIFS_OPEN_DATA_MODEL = "aifs-single" as const;

export function buildAifsOpenDataForecastUrl(
  run: Date,
  forecastHour: number,
  baseUrl: string = IFS_OPEN_DATA_MIRRORS[0].baseUrl,
): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  return `${baseUrl}/${date}/${hour}z/${AIFS_OPEN_DATA_MODEL}/0p25/oper/${date}${hour}0000-${forecastHour}h-oper-fc.grib2`;
}

export function buildAifsOpenDataForecastIndexUrl(
  run: Date,
  forecastHour: number,
  baseUrl = IFS_OPEN_DATA_MIRRORS[0].baseUrl,
): string {
  return buildAifsOpenDataForecastUrl(run, forecastHour, baseUrl).replace(/\.grib2$/, ".index");
}

export interface AifsAvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean>;
}

export class AifsOpenDataRunProbe implements AifsAvailabilityProbe {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy?: IfsHttpAccessPolicy,
  ) {}

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    for (const mirror of IFS_OPEN_DATA_MIRRORS) {
      const url = buildAifsOpenDataForecastIndexUrl(run, forecastHour, mirror.baseUrl);
      const result = await runIfsHttpWithRetry(() =>
        runWithAccessPolicy(this.accessPolicy, url, async () => {
          const response = await this.fetchFn(url, {
            headers: { "user-agent": "weather-for-grown-ups/0.3" },
          });
          return {
            status: response.status,
            statusText: response.statusText,
            retryAfter: response.headers.get("retry-after"),
            ...(response.ok ? { value: await response.text() } : {}),
          };
        }),
      );
      if (result.status === 404 || isRetryableHttpStatus(result.status)) continue;
      if (result.status < 200 || result.status >= 300) {
        throw new Error(
          `ECMWF AIFS run discovery failed: HTTP ${result.status} ${result.statusText} for ${url}`,
        );
      }
      if (result.value === undefined) {
        throw new Error(`ECMWF AIFS run discovery returned an empty index for ${url}`);
      }
      try {
        selectIfsIndexEntries(parseIfsOpenDataIndex(result.value), selectors);
        return true;
      } catch (error) {
        if (
          error instanceof Error
          && error.message.startsWith("ECMWF IFS index is missing requested fields:")
        ) {
          continue;
        }
        throw error;
      }
    }
    return false;
  }
}

function runWithAccessPolicy<T>(
  policy: IfsHttpAccessPolicy | undefined,
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  return policy === undefined ? operation() : policy.run(url, operation);
}

function yyyymmdd(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}
