import type { UpstreamAccessPolicy } from "./access-policy.js";
import {
  runWithHttpRetry,
  type HttpRetryExecutionOptions,
} from "./http-retry.js";

export interface RetryableFetchOptions extends HttpRetryExecutionOptions {
  fetchFn?: typeof fetch;
  accessPolicy?: UpstreamAccessPolicy;
}

export interface ConsumedFetchOptions extends RetryableFetchOptions {
  /** Only buffer this status; cancel bodies on other responses. */
  expectedStatus?: number;
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
 * Consume a binary response within each attempt's access-policy slot. Body
 * transport failures retry the whole GET; backoff happens after releasing the
 * slot. Unsuccessful/unexpected responses are cancelled and return empty bytes
 * so callers can retain their provider-specific HTTP failure mapping.
 */
export async function fetchBinaryWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  options: ConsumedFetchOptions = {},
): Promise<{ response: Response; bytes: Uint8Array }> {
  const { response, value } = await fetchConsumedWithRetry(
    input, init, options,
    async (response) => new Uint8Array(await response.arrayBuffer()),
    new Uint8Array(),
  );
  return { response, bytes: value };
}

/** Text inventories need the same body retry and concurrency policy as GRIB. */
export async function fetchTextWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  options: ConsumedFetchOptions = {},
): Promise<{ response: Response; text: string }> {
  const { response, value } = await fetchConsumedWithRetry(
    input, init, options, (response) => response.text(), "",
  );
  return { response, text: value };
}

async function fetchConsumedWithRetry<T>(
  input: string | URL,
  init: RequestInit | undefined,
  options: ConsumedFetchOptions,
  consume: (response: Response) => Promise<T>,
  empty: T,
): Promise<{ response: Response; value: T }> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const run = <T>(operation: () => Promise<T>) =>
    options.accessPolicy?.run(operation) ?? operation();

  return runWithHttpRetry(() =>
    run(async () => {
      const response = await fetchFn(input, init);
      const accepted = options.expectedStatus === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === options.expectedStatus;
      let value = empty;
      try {
        if (accepted) value = await consume(response);
        else await cancelResponseBody(response);
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        response,
        value,
      };
    }), options);
}

async function cancelResponseBody(response: Response): Promise<void> {
  // Preserve the HTTP status or original transport failure if cleanup fails.
  await response.body?.cancel().catch(() => undefined);
}
