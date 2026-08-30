import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../src/access/http-fetch.js";

describe("fetchWithRetry", () => {
  it("runs every HTTP attempt through the supplied access policy", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("busy", {
        status: 503,
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithRetry("https://example.test/data", undefined, {
      fetchFn,
      accessPolicy: { run },
      baseDelayMs: 0,
      jitterRatio: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries retryable transport failures and then returns the response", async () => {
    const transportError = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    transportError.cause = { code: "UND_ERR_SOCKET" };
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithRetry("https://example.test/data", undefined, {
      fetchFn,
      baseDelayMs: 0,
      jitterRatio: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry terminal HTTP responses", async () => {
    const fetchFn = vi.fn(async () => new Response("missing", { status: 404 }));

    const response = await fetchWithRetry("https://example.test/data", undefined, {
      fetchFn,
      baseDelayMs: 0,
      jitterRatio: 0,
    });

    expect(response.status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid retry configuration and terminal transport failures", async () => {
    await expect(fetchWithRetry("https://example.test/data", undefined, {
      fetchFn: vi.fn(),
      maxAttempts: 0,
    })).rejects.toThrow(/maxAttempts/);

    const fetchFn = vi.fn(async () => {
      throw new TypeError("bad application input");
    });
    await expect(fetchWithRetry("https://example.test/data", undefined, {
      fetchFn,
      maxAttempts: 2,
      baseDelayMs: 0,
      jitterRatio: 0,
    })).rejects.toThrow("bad application input");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
