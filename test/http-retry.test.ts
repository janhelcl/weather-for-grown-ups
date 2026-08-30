import { describe, expect, it, vi } from "vitest";
import {
  exponentialBackoffMilliseconds,
  isRetryableHttpStatus,
  isRetryableHttpTransportError,
  retryAfterMilliseconds,
  waitBeforeHttpRetry,
} from "../src/sources/http-retry.js";

describe("HTTP retry helpers", () => {
  it("retries throttling and transient server failures but not terminal statuses", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableHttpStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409]) {
      expect(isRetryableHttpStatus(status)).toBe(false);
    }
  });

  it("recognizes fetch transport failures without treating arbitrary errors as retryable", () => {
    const socketError = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    socketError.cause = { code: "UND_ERR_SOCKET" };
    expect(isRetryableHttpTransportError(socketError)).toBe(true);
    expect(isRetryableHttpTransportError(new TypeError("network request failed"))).toBe(true);
    expect(isRetryableHttpTransportError(new TypeError("bad application input"))).toBe(false);
    expect(isRetryableHttpTransportError(new Error("fetch failed"))).toBe(false);
  });

  it("computes exponential backoff with deterministic jitter injection", () => {
    expect(exponentialBackoffMilliseconds(1, {
      baseDelayMs: 500,
      jitterRatio: 0,
    })).toBe(500);
    expect(exponentialBackoffMilliseconds(2, {
      baseDelayMs: 500,
      jitterRatio: 0,
    })).toBe(1_000);
    expect(exponentialBackoffMilliseconds(5, {
      baseDelayMs: 500,
      maxDelayMs: 3_000,
      jitterRatio: 0,
    })).toBe(3_000);
  });

  it("honors Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMilliseconds("2", 1_000)).toBe(2_000);
    expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:05 GMT", 1_000)).toBe(4_000);
    expect(retryAfterMilliseconds("invalid", 1_000)).toBeUndefined();
  });

  it("uses Retry-After instead of local exponential delay", async () => {
    const sleepFn = vi.fn(async (_milliseconds: number) => undefined);
    await waitBeforeHttpRetry(2, "3", {
      baseDelayMs: 500,
      jitterRatio: 0,
      sleepFn,
    });
    expect(sleepFn).toHaveBeenCalledWith(3_000);
  });

  it("can disable sleeping for transport unit tests", async () => {
    const sleepFn = vi.fn(async (_milliseconds: number) => undefined);
    await waitBeforeHttpRetry(1, null, {
      baseDelayMs: 0,
      jitterRatio: 0,
      sleepFn,
    });
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
