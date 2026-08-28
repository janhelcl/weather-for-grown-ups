import {
  parseGribIndex,
  type GribIndexEntry,
} from "@mattnucc/gribberish";

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

export async function fetchIfsWithRetry(
  fetchFn: typeof fetch,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < IFS_HTTP_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchFn(input, init);
    if (!isRetryableStatus(response.status) || attempt === IFS_HTTP_MAX_ATTEMPTS - 1) return response;
    lastResponse = response;
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
    const delayMs = retryAfterMs ?? IFS_HTTP_INITIAL_BACKOFF_MS * 2 ** attempt;
    await sleep(delayMs);
  }
  if (lastResponse !== undefined) return lastResponse;
  throw new Error("ECMWF IFS retry loop completed without a response");
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
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    return isIfsProductAvailable(this.fetchFn, run, forecastHour, selectors, "oper-fc");
  }
}

export class IfsEnsOpenDataRunProbe implements IfsAvailabilityProbe {
  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    selectors: readonly IfsIndexSelector[],
  ): Promise<boolean> {
    const sharedRunStatic = selectors.filter(isIfsSharedRunStaticSelector);
    const perturbationSelectors = selectors.filter((selector) => !isIfsSharedRunStaticSelector(selector));

    if (
      perturbationSelectors.length > 0
      && !await isIfsProductAvailable(this.fetchFn, run, forecastHour, perturbationSelectors, "enfo-ef")
    ) {
      return false;
    }
    if (sharedRunStatic.length > 0) {
      const deterministicSelectors = sharedRunStatic.map(withoutIfsMemberNumber);
      if (!await isIfsProductAvailable(this.fetchFn, run, forecastHour, deterministicSelectors, "oper-fc")) {
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
): Promise<boolean> {
  for (const mirror of IFS_OPEN_DATA_MIRRORS) {
    const url = buildIfsOpenDataForecastIndexUrl(run, forecastHour, mirror.baseUrl, product);
    const response = await fetchIfsWithRetry(fetchFn, url, {
      headers: { "user-agent": "weather-for-grown-ups/0.2" },
    });
    if (response.status === 404 || isRetryableStatus(response.status)) continue;
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
        continue;
      }
      throw error;
    }
  }
  return false;
}

function memberSuffix(selector: IfsIndexSelector): string {
  return selector.number === undefined ? "" : `#member${selector.number.toString().padStart(2, "0")}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || (status >= 500 && status <= 599);
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
