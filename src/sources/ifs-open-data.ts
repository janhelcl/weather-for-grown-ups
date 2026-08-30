import {
  parseGribIndex,
  type GribIndexEntry,
} from "@mattnucc/gribberish";
import { runWithHttpRetry } from "../access/http-retry.js";

export const IFS_OPEN_DATA_BASE_URL = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com";
export const IFS_OPEN_DATA_MIRRORS = [
  { id: "aws", baseUrl: IFS_OPEN_DATA_BASE_URL },
  { id: "google", baseUrl: "https://storage.googleapis.com/ecmwf-open-data" },
  { id: "ecmwf", baseUrl: "https://data.ecmwf.int/forecasts" },
] as const;

export type IfsOpenDataMirror = (typeof IFS_OPEN_DATA_MIRRORS)[number];

export type IfsOpenDataProduct = "oper-fc" | "enfo-ef";

export interface IfsIndexSelector {
  key: string;
  param: string;
  levtype: "pl" | "sfc";
  levelist?: number;
  /** ECMWF perturbed ensemble member number, 1..50. Omitted for deterministic IFS. */
  number?: number;
  /** Override the requested forecast step for run-static/source-special fields. */
  sourceForecastHour?: number;
}

export const IFS_HTTP_MAX_ATTEMPTS = 4;
export const IFS_HTTP_INITIAL_BACKOFF_MS = 750;

export interface IfsHttpAccessPolicy {
  run<T>(url: string, operation: () => Promise<T>): Promise<T>;
}

export interface IfsHttpAttemptResult<T> {
  status: number;
  statusText: string;
  retryAfter: string | null;
  value?: T;
}

export function runIfsHttpWithRetry<T>(
  operation: () => Promise<IfsHttpAttemptResult<T>>,
): Promise<IfsHttpAttemptResult<T>> {
  return runWithHttpRetry(operation, {
    maxAttempts: IFS_HTTP_MAX_ATTEMPTS,
    baseDelayMs: IFS_HTTP_INITIAL_BACKOFF_MS,
  });
}

export async function fetchIfsWithRetry(
  fetchFn: typeof fetch,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const result = await runIfsHttpWithRetry(async () => {
    const response = await fetchFn(input, init);
    return {
      status: response.status,
      statusText: response.statusText,
      retryAfter: response.headers.get("retry-after"),
      value: response,
    };
  });
  if (result.value === undefined) {
    throw new Error("ECMWF IFS retry loop returned no response");
  }
  return result.value;
}

export interface IfsAvailabilityProbe {
  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean>;
}

export function buildIfsOpenDataForecastUrl(
  run: Date,
  forecastHour: number,
  baseUrl = IFS_OPEN_DATA_BASE_URL,
  product: IfsOpenDataProduct = "oper-fc",
): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const step = `${forecastHour}h`;
  const [stream, type] = product.split("-") as ["oper" | "enfo", "fc" | "ef"];
  return `${baseUrl}/${date}/${hour}z/ifs/0p25/${stream}/${date}${hour}0000-${step}-${stream}-${type}.grib2`;
}

export function buildIfsOpenDataForecastIndexUrl(
  run: Date,
  forecastHour: number,
  baseUrl = IFS_OPEN_DATA_BASE_URL,
  product: IfsOpenDataProduct = "oper-fc",
): string {
  return buildIfsOpenDataForecastUrl(run, forecastHour, baseUrl, product).replace(/\.grib2$/, ".index");
}

export function buildIfsEnsOpenDataForecastUrl(
  run: Date,
  forecastHour: number,
  baseUrl = IFS_OPEN_DATA_BASE_URL,
): string {
  return buildIfsOpenDataForecastUrl(run, forecastHour, baseUrl, "enfo-ef");
}

export function buildIfsEnsOpenDataForecastIndexUrl(
  run: Date,
  forecastHour: number,
  baseUrl = IFS_OPEN_DATA_BASE_URL,
): string {
  return buildIfsOpenDataForecastIndexUrl(run, forecastHour, baseUrl, "enfo-ef");
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
      if (selector.levtype === "pl" && entry.keys.levelist !== String(selector.levelist)) {
        return false;
      }
      if (selector.number !== undefined && entry.keys.number !== String(selector.number)) {
        return false;
      }
      return true;
    });
    if (!match) {
      missing.push(
        selector.levtype === "pl"
          ? `${selector.param}@${selector.levelist}hPa${memberSuffix(selector)}`
          : `${selector.param}@sfc${memberSuffix(selector)}`,
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
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy?: IfsHttpAccessPolicy,
  ) {}

  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    return isIfsProductAvailable(
      this.fetchFn,
      run,
      forecastHour,
      selectors,
      "oper-fc",
      this.accessPolicy,
    );
  }
}

export class IfsEnsOpenDataRunProbe implements IfsAvailabilityProbe {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly accessPolicy?: IfsHttpAccessPolicy,
  ) {}

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    const sharedRunStatic = selectors.filter(isIfsSharedRunStaticSelector);
    const perturbationSelectors = selectors.filter((selector) => !isIfsSharedRunStaticSelector(selector));

    if (
      perturbationSelectors.length > 0
      && !await isIfsProductAvailable(
        this.fetchFn,
        run,
        forecastHour,
        perturbationSelectors,
        "enfo-ef",
        this.accessPolicy,
      )
    ) {
      return false;
    }
    if (sharedRunStatic.length > 0) {
      const deterministicSelectors = sharedRunStatic.map(withoutIfsMemberNumber);
      if (!await isIfsProductAvailable(
        this.fetchFn,
        run,
        forecastHour,
        deterministicSelectors,
        "oper-fc",
        this.accessPolicy,
      )) {
        return false;
      }
    }
    return true;
  }
}

export function isIfsSharedRunStaticSelector(selector: IfsIndexSelector): boolean {
  return selector.sourceForecastHour === 0;
}

function withoutIfsMemberNumber(selector: IfsIndexSelector): IfsIndexSelector {
  const { number: _number, ...rest } = selector;
  return rest;
}

async function isIfsProductAvailable(
  fetchFn: typeof fetch,
  run: Date,
  forecastHour: number,
  selectors: readonly IfsIndexSelector[],
  product: IfsOpenDataProduct,
  accessPolicy?: IfsHttpAccessPolicy,
): Promise<boolean> {
  for (const mirror of IFS_OPEN_DATA_MIRRORS) {
    const url = buildIfsOpenDataForecastIndexUrl(run, forecastHour, mirror.baseUrl, product);
    const result = await runIfsHttpWithRetry(() =>
      runWithIfsAccessPolicy(accessPolicy, url, async () => {
        const response = await fetchFn(url, {
          headers: { "user-agent": "weather-for-grown-ups/0.2" },
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
        `ECMWF IFS run discovery failed: HTTP ${result.status} ${result.statusText} for ${url}`,
      );
    }
    if (result.value === undefined) {
      throw new Error(`ECMWF IFS run discovery returned an empty index for ${url}`);
    }
    const entries = parseIfsOpenDataIndex(result.value);
    try {
      selectIfsIndexEntries(entries, selectors);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ECMWF IFS index is missing requested fields:")) {
        continue;
      }
      throw error;
    }
  }
  return false;
}

function runWithIfsAccessPolicy<T>(
  accessPolicy: IfsHttpAccessPolicy | undefined,
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  return accessPolicy === undefined ? operation() : accessPolicy.run(url, operation);
}

function memberSuffix(selector: IfsIndexSelector): string {
  return selector.number === undefined ? "" : `#member${selector.number.toString().padStart(2, "0")}`;
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
