import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
  redactSensitiveText,
  type WfgError,
} from "../failure.js";

export interface UpstreamHttpFailureContext {
  /** Human-readable provider name, e.g. "NOAA AWS Open Data". */
  provider: string;
  /** What was being fetched, e.g. "GFS index" or "GEFS member byte range". */
  operation: string;
  status: number;
  statusText?: string | null;
  /**
   * What a 404 means for this request, e.g. "GFS run 2026-09-05T06:00Z f030".
   * When present, a 404 is reported as a provider-confirmed absence of that
   * resource instead of a generic transport rejection.
   */
  resource?: string;
  url?: string;
  details?: Record<string, unknown>;
}

/**
 * Translate a terminal (post-retry) upstream HTTP status into the public
 * failure taxonomy. Transport policy owns this mapping so cache and source
 * modules do not each invent their own interpretation of provider status codes:
 *
 * - 404 → `DATA_UNAVAILABLE` (the provider confirmed the object is not there);
 * - 429 → `RATE_LIMITED`;
 * - 5xx → `UPSTREAM_UNAVAILABLE`, retryable;
 * - anything else non-2xx → `UPSTREAM_UNAVAILABLE`, not retryable (the provider
 *   rejected a request WFG considered well-formed).
 */
export function upstreamHttpFailure(context: UpstreamHttpFailureContext): WfgError {
  const status = context.status;
  const statusLabel = formatHttpStatus(status, context.statusText);
  const details = {
    provider: context.provider,
    status,
    ...(context.url === undefined ? {} : { url: redactSensitiveText(context.url) }),
    ...(context.details ?? {}),
  };

  if (status === 404) {
    return new DataUnavailableError(
      context.resource === undefined
        ? `${context.provider} has no object for the ${context.operation} (${statusLabel})`
        : `${context.provider} has not published ${context.resource} (${statusLabel})`,
      { retryable: false, details },
    );
  }
  if (status === 429) {
    return new RateLimitedError(
      `${context.provider} rate limit remained exhausted after retries during the ${context.operation} (${statusLabel})`,
      { details },
    );
  }
  if (status >= 500 && status <= 599) {
    return new UpstreamUnavailableError(
      `${context.provider} is unavailable after retries during the ${context.operation} (${statusLabel})`,
      { retryable: true, details },
    );
  }
  return new UpstreamUnavailableError(
    `${context.provider} rejected the ${context.operation} (${statusLabel})`,
    { retryable: false, details },
  );
}

export function formatHttpStatus(status: number, statusText?: string | null): string {
  const text = typeof statusText === "string" ? statusText.trim() : "";
  return text.length === 0 ? `HTTP ${status}` : `HTTP ${status} ${text}`;
}
