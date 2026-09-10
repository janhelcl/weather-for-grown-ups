import type { UpstreamAccessPolicy } from "./access-policy.js";
import {
  runWithHttpRetry,
  type HttpRetryExecutionOptions,
} from "./http-retry.js";

export interface RetryableFetchOptions extends HttpRetryExecutionOptions {
  fetchFn?: typeof fetch;
  accessPolicy?: UpstreamAccessPolicy;
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
  const run = <T>(operation: () => Promise<T>) =>
    options.accessPolicy?.run(operation) ?? operation();

  const result = await runWithHttpRetry(async () => {
    const response = await run(() => fetchFn(input, init));
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      response,
    };
  }, options);

  return result.response;
}

/**
 * Like `fetchWithRetry`, but the access-policy slot covers header and body so
 * concurrent range workers cannot overlap more transfers than `maxConcurrency`.
 */
export async function fetchBinaryWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  options: RetryableFetchOptions = {},
): Promise<{ response: Response; bytes: Uint8Array }> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const run = <T>(operation: () => Promise<T>) =>
    options.accessPolicy?.run(operation) ?? operation();

  return run(async () => {
    const result = await runWithHttpRetry(async () => {
      const response = await fetchFn(input, init);
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        response,
      };
    }, options);
    return {
      response: result.response,
      bytes: new Uint8Array(await result.response.arrayBuffer()),
    };
  });
}
