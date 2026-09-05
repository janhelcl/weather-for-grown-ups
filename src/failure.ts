export const PUBLIC_FAILURE_CODES = [
  "INVALID_REQUEST",
  "UNSUPPORTED_OPERATION",
  "OUT_OF_DOMAIN",
  "DATA_UNAVAILABLE",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type PublicFailureCode = (typeof PUBLIC_FAILURE_CODES)[number];

export interface PublicFailure {
  code: PublicFailureCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface WfgErrorOptions extends ErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class WfgError extends Error {
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: PublicFailureCode,
    message: string,
    options: WfgErrorOptions = {},
  ) {
    super(message, options);
    this.name = "WfgError";
    this.retryable = options.retryable ?? defaultRetryable(code);
    if (options.details !== undefined) this.details = options.details;
  }
}

export class InvalidRequestError extends WfgError {
  constructor(message: string, options: Omit<WfgErrorOptions, "retryable"> = {}) {
    super("INVALID_REQUEST", message, { ...options, retryable: false });
    this.name = "InvalidRequestError";
  }
}

export class UnsupportedOperationError extends WfgError {
  constructor(message: string, options: Omit<WfgErrorOptions, "retryable"> = {}) {
    super("UNSUPPORTED_OPERATION", message, { ...options, retryable: false });
    this.name = "UnsupportedOperationError";
  }
}

export class DataUnavailableError extends WfgError {
  constructor(message: string, options: WfgErrorOptions = {}) {
    super("DATA_UNAVAILABLE", message, options);
    this.name = "DataUnavailableError";
  }
}

export class RateLimitedError extends WfgError {
  constructor(message: string, options: Omit<WfgErrorOptions, "retryable"> = {}) {
    super("RATE_LIMITED", message, { ...options, retryable: true });
    this.name = "RateLimitedError";
  }
}

export class UpstreamUnavailableError extends WfgError {
  constructor(message: string, options: WfgErrorOptions = {}) {
    super("UPSTREAM_UNAVAILABLE", message, options);
    this.name = "UpstreamUnavailableError";
  }
}

export function toPublicFailure(error: unknown): PublicFailure {
  if (error instanceof WfgError) return failureFromWfgError(error);

  if (isKnownCodedError(error)) {
    return {
      code: error.code,
      message: safeMessage(error),
      retryable: typeof error.retryable === "boolean"
        ? error.retryable
        : defaultRetryable(error.code),
      ...(isSafeDetails(error.details) ? { details: error.details } : {}),
    };
  }

  if (isZodError(error)) {
    const issues = zodIssueDetails(error);
    return {
      code: "INVALID_REQUEST",
      message: zodFailureMessage(issues),
      retryable: false,
      ...(issues.length === 0 ? {} : { details: { issues } }),
    };
  }

  const status = httpStatus(error);
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Upstream provider rate limit exhausted after retries",
      retryable: true,
    };
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return {
      code: "UPSTREAM_UNAVAILABLE",
      message: `Upstream provider unavailable after retries (HTTP ${status})`,
      retryable: true,
    };
  }

  if (isTransportFailure(error)) {
    return {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Upstream provider could not be reached after retries",
      retryable: true,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: internalErrorMessage(error),
    retryable: false,
  };
}

const GENERIC_INTERNAL_MESSAGE = "Unexpected internal error while handling the request";
const MAX_INTERNAL_MESSAGE_LENGTH = 600;

/**
 * Plain `Error` instances thrown below the public boundary usually carry the
 * actionable explanation (guardrail exceeded, unsupported selection, missing
 * local dependency). Surface that text instead of discarding it, but keep the
 * output single-line, bounded, and free of credentials. Non-Error throwables
 * (strings, objects) stay generic because their shape is unknown.
 */
function internalErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC_INTERNAL_MESSAGE;
  const message = redactSensitiveText(error.message).replace(/\s+/g, " ").trim();
  if (message.length === 0) return GENERIC_INTERNAL_MESSAGE;
  return message.length > MAX_INTERNAL_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_INTERNAL_MESSAGE_LENGTH - 1)}…`
    : message;
}

const SENSITIVE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [
    /([?&](?:token|access_token|apikey|api_key|api-key|key|secret|password|signature|x-amz-[a-z-]+)=)[^&\s"']+/gi,
    "$1[redacted]",
  ],
  [
    /((?:^|[\s_-])(?:authorization|api[-_]?key|token|password|secret)\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi,
    "$1[redacted]",
  ],
];

export function redactSensitiveText(text: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

export function formatPublicFailure(failure: PublicFailure): string {
  return `${failure.code}: ${failure.message}`;
}

function failureFromWfgError(error: WfgError): PublicFailure {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}

function defaultRetryable(code: PublicFailureCode): boolean {
  return code === "RATE_LIMITED" || code === "UPSTREAM_UNAVAILABLE";
}

function isKnownCodedError(error: unknown): error is {
  code: PublicFailureCode;
  message?: unknown;
  retryable?: unknown;
  details?: unknown;
} {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return PUBLIC_FAILURE_CODES.includes(
    (error as { code: PublicFailureCode }).code,
  );
}

function safeMessage(error: { message?: unknown }): string {
  return typeof error.message === "string" && error.message.trim().length > 0
    ? error.message
    : "Request failed";
}

function isSafeDetails(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ZodLikeIssue {
  code?: unknown;
  path?: unknown[];
  message?: unknown;
  errors?: unknown;
}

interface ZodLikeError {
  name: "ZodError";
  issues?: ZodLikeIssue[];
}

function isZodError(error: unknown): error is ZodLikeError {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "ZodError";
}

/**
 * Lead with the first issue and its field path so an agent can correct the
 * request from the message alone; the bounded full list stays in details.issues.
 */
function zodFailureMessage(issues: Array<{ path: string; message: string }>): string {
  if (issues.length === 0) return "Request validation failed";
  const [first] = issues;
  const lead = first!.path.length === 0
    ? `Request validation failed: ${first!.message}`
    : `Request validation failed at ${first!.path}: ${first!.message}`;
  return issues.length === 1
    ? lead
    : `${lead} (+${issues.length - 1} more in details.issues)`;
}

const MAX_REPORTED_ISSUES = 8;

function zodIssueDetails(error: ZodLikeError): Array<{ path: string; message: string }> {
  if (!Array.isArray(error.issues)) return [];
  return flattenZodIssues(error.issues, []).slice(0, MAX_REPORTED_ISSUES);
}

/**
 * A plain union reports "Invalid input" at the union root and hides the branch
 * issues underneath. When one branch is clearly closest (fewest issues), report
 * that branch's issues at their full path; otherwise summarise the tied branches
 * so the caller sees what each form was missing instead of an opaque failure.
 */
function flattenZodIssues(
  issues: ZodLikeIssue[],
  prefix: string[],
): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const issue of issues) {
    const path = [...prefix, ...(Array.isArray(issue.path) ? issue.path.map(String) : [])];
    const branches = issue.code === "invalid_union" && Array.isArray(issue.errors)
      ? (issue.errors as unknown[]).filter((branch): branch is ZodLikeIssue[] => Array.isArray(branch))
      : [];
    if (branches.length === 0) {
      out.push({
        path: path.join("."),
        message: typeof issue.message === "string" ? issue.message : "Invalid value",
      });
      continue;
    }
    const fewest = Math.min(...branches.map((branch) => branch.length));
    const closest = branches.filter((branch) => branch.length === fewest);
    if (closest.length === 1) {
      out.push(...flattenZodIssues(closest[0]!, path));
      continue;
    }
    const summary = closest
      .slice(0, 3)
      .map((branch) => flattenZodIssues(branch, [])
        .map((entry) => (entry.path.length === 0 ? entry.message : `${entry.path}: ${entry.message}`))
        .join("; "))
      .map((text) => `[${text}]`)
      .join(" or ");
    const lead = typeof issue.message === "string" && issue.message !== "Invalid input"
      ? issue.message
      : "No accepted form matched";
    out.push({ path: path.join("."), message: `${lead}. Closest forms: ${summary}` });
  }
  return out;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["status", "statusCode"] as const) {
    if (!(key in error)) continue;
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as TypeError & { cause?: unknown }).cause;
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  if (typeof code === "string" && TRANSPORT_ERROR_CODES.has(code)) return true;
  return /fetch failed|network|socket/i.test(error.message);
}
