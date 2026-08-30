import type { UpstreamAccessPolicy } from "./access-policy.js";
import {
  DEFAULT_HTTP_RETRY_MAX_ATTEMPTS,
  isRetryableHttpStatus,
  isRetryableHttpTransportError,
  waitBeforeHttpRetry,
  type HttpRetryWaitOptions,
} from "./http-retry.js";

export interface RetryableFetchOptions extends HttpRetryWaitOptions {
  fetchFn?: typeof fetch;
  accessPolicy?: UpstreamAccessPolicy;
  maxAttempts?: number;
}

/**
 * Shared HTTP execution policy: provider concurrency/pacing is applied to every
 * attempt, then transient HTTP/transport failures use the common retry policy.
 * Callers retain responsibility for provider-specific success validation and
 * response decoding.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  options: RetryableFetchOptions = {},
): Promise<Response> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? DEFAULT_HTTP_RETRY_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("HTTP maxAttempts must be a positive integer");
  }
  const run = <T>(operation: () => Promise<T>) =>
    options.accessPolicy?.run(operation) ?? operation();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await run(() => fetchFn(input, init));
      if (isRetryableHttpStatus(response.status) && attempt < maxAttempts) {
        await waitBeforeHttpRetry(attempt, response.headers.get("retry-after"), options);
        continue;
      }
      return response;
    } catch (error) {
      if (!isRetryableHttpTransportError(error) || attempt >= maxAttempts) throw error;
      await waitBeforeHttpRetry(attempt, null, options);
    }
  }
  throw new Error("HTTP retry loop exhausted unexpectedly");
}
