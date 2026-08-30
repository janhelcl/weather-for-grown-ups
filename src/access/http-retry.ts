export const DEFAULT_HTTP_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_HTTP_RETRY_MAX_DELAY_MS = 10_000;
export const DEFAULT_HTTP_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_HTTP_RETRY_JITTER_RATIO = 0.2;

export interface HttpRetryAttemptResult {
  status: number;
  retryAfter: string | null;
}

export interface HttpRetryExecutionOptions extends HttpRetryWaitOptions {
  maxAttempts?: number;
}

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

const RETRYABLE_TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH",
  "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

export function isRetryableHttpTransportError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as TypeError & { cause?: unknown }).cause;
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  if (typeof code === "string" && RETRYABLE_TRANSPORT_ERROR_CODES.has(code)) return true;
  return /fetch failed|network|socket/i.test(error.message);
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
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

export async function runWithHttpRetry<T extends HttpRetryAttemptResult>(
  operation: () => Promise<T>,
  options: HttpRetryExecutionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_HTTP_RETRY_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("HTTP maxAttempts must be a positive integer");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      if (isRetryableHttpStatus(result.status) && attempt < maxAttempts) {
        await waitBeforeHttpRetry(attempt, result.retryAfter, options);
        continue;
      }
      return result;
    } catch (error) {
      if (!isRetryableHttpTransportError(error) || attempt >= maxAttempts) throw error;
      await waitBeforeHttpRetry(attempt, null, options);
    }
  }

  throw new Error("HTTP retry loop exhausted unexpectedly");
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
