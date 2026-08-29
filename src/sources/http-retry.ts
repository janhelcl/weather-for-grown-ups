export const DEFAULT_HTTP_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_HTTP_RETRY_MAX_DELAY_MS = 10_000;
export const DEFAULT_HTTP_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_HTTP_RETRY_JITTER_RATIO = 0.2;

export interface HttpRetryWaitOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleepFn?: (milliseconds: number) => Promise<void>;
  randomFn?: () => number;
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

export function exponentialBackoffMilliseconds(
  attempt: number,
  options: Omit<HttpRetryWaitOptions, "sleepFn"> = {},
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("retry attempt must be a positive integer");
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_HTTP_RETRY_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_HTTP_RETRY_MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_HTTP_RETRY_JITTER_RATIO;
  const randomFn = options.randomFn ?? Math.random;
  if (baseDelayMs < 0 || maxDelayMs < 0 || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("invalid HTTP retry timing options");
  }

  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = exponential * jitterRatio * (2 * randomFn() - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

export async function waitBeforeHttpRetry(
  attempt: number,
  retryAfterHeader: string | null,
  options: HttpRetryWaitOptions = {},
): Promise<void> {
  const sleepFn = options.sleepFn ?? sleep;
  const retryAfterMs = retryAfterMilliseconds(retryAfterHeader);
  const delayMs = retryAfterMs ?? exponentialBackoffMilliseconds(attempt, options);
  if (delayMs > 0) await sleepFn(delayMs);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
