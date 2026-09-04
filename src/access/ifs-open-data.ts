import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "./access-policy.js";
import { runWithHttpRetry } from "./http-retry.js";

const ECMWF_DIRECT_OPEN_DATA_BASE_URL = "https://data.ecmwf.int/forecasts";

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

export class IfsOpenDataAccessPolicy implements IfsHttpAccessPolicy {
  private readonly cloudPolicy: UpstreamAccessPolicy;
  private readonly directPolicy: UpstreamAccessPolicy;

  constructor(
    stateDir: string,
    cloudPolicy?: UpstreamAccessPolicy,
    directPolicy?: UpstreamAccessPolicy,
  ) {
    this.cloudPolicy = cloudPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfCloud);
    this.directPolicy = directPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfDirect);
  }

  run<T>(url: string, operation: () => Promise<T>): Promise<T> {
    return this.policyForUrl(url).run(operation);
  }

  private policyForUrl(url: string): UpstreamAccessPolicy {
    return url.startsWith(ECMWF_DIRECT_OPEN_DATA_BASE_URL)
      ? this.directPolicy
      : this.cloudPolicy;
  }
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
