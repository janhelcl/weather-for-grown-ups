import { describe, expect, it, vi } from "vitest";
import { fetchBinaryWithRetry, fetchTextWithRetry, fetchWithRetry } from "../src/access/http-fetch.js";

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

describe("fetchBinaryWithRetry", () => {
  it("retries an interrupted body and releases the policy slot before backoff", async () => {
    let active = false;
    const run = vi.fn(async <T>(operation: () => Promise<T>) => {
      expect(active).toBe(false);
      active = true;
      try { return await operation(); } finally { active = false; }
    });
    const broken = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("GR"));
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
      },
    }), { status: 206 });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(new Response("GRIBcomplete", { status: 206 }));
    const sleepFn = vi.fn(async () => { expect(active).toBe(false); });
    const result = await fetchBinaryWithRetry("https://example.test/data", undefined, {
      fetchFn, accessPolicy: { run }, sleepFn, jitterRatio: 0,
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("GRIBcomplete");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("cancels a throttled response before releasing the slot and respects Retry-After", async () => {
    let active = false;
    const cancel = vi.fn(() => { expect(active).toBe(true); });
    const run = vi.fn(async <T>(operation: () => Promise<T>) => {
      active = true;
      try { return await operation(); } finally { active = false; }
    });
    const busy = new Response(new ReadableStream({ cancel }), {
      status: 429, headers: { "retry-after": "2" },
    });
    const fetchFn = vi.fn().mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(new Response("GRIB", { status: 206 }));
    const sleepFn = vi.fn(async () => {
      expect(active).toBe(false);
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    await fetchBinaryWithRetry("https://example.test/data", undefined, {
      fetchFn, accessPolicy: { run }, sleepFn,
    });
    expect(sleepFn).toHaveBeenCalledWith(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([200, 404, 503])("does not buffer an unexpected HTTP %i range response", async (status) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status });
    const read = vi.spyOn(response, "arrayBuffer");
    const result = await fetchBinaryWithRetry("https://example.test/data", undefined, {
      fetchFn: vi.fn().mockResolvedValue(response), expectedStatus: 206, maxAttempts: 1,
    });
    expect(result.response.status).toBe(status);
    expect(result.bytes.byteLength).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds body retries and leaves aborts terminal", async () => {
    const fetchFn = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
      },
    })));
    await expect(fetchBinaryWithRetry("https://example.test/data", undefined, {
      fetchFn, maxAttempts: 2, baseDelayMs: 0,
    })).rejects.toThrow("terminated");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const aborted = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new DOMException("cancelled", "AbortError")); },
    })));
    await expect(fetchBinaryWithRetry("https://example.test/data", undefined, {
      fetchFn: aborted, baseDelayMs: 0,
    })).rejects.toThrow("cancelled");
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("keeps the access-policy slot until the response body is read", async () => {
    let inBody = 0;
    let maxInBody = 0;
    let locked = Promise.resolve();
    const run = async <T>(operation: () => Promise<T>) => {
      const wait = locked;
      let unlock: () => void = () => undefined;
      locked = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await wait;
      try {
        return await operation();
      } finally {
        unlock();
      }
    };
    const fetchFn = vi.fn(async () => ({
      status: 206,
      statusText: "Partial Content",
      headers: { get: () => null },
      arrayBuffer: async () => {
        inBody += 1;
        maxInBody = Math.max(maxInBody, inBody);
        await new Promise((resolve) => setTimeout(resolve, 25));
        inBody -= 1;
        return new Uint8Array([71, 82, 73, 66]).buffer;
      },
    })) as unknown as typeof fetch;

    await Promise.all([
      fetchBinaryWithRetry("https://example.test/range", undefined, {
        fetchFn,
        accessPolicy: { run },
      }),
      fetchBinaryWithRetry("https://example.test/range", undefined, {
        fetchFn,
        accessPolicy: { run },
      }),
    ]);

    expect(maxInBody).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("fetchTextWithRetry", () => {
  it("retries interrupted inventories within a fresh policy slot", async () => {
    let active = false;
    const run = vi.fn(async <T>(operation: () => Promise<T>) => {
      active = true;
      try { return await operation(); } finally { active = false; }
    });
    const broken = new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
      },
    }));
    const complete = new Response("1:0:TMP:850 mb");
    const read = complete.text.bind(complete);
    vi.spyOn(complete, "text").mockImplementation(async () => {
      expect(active).toBe(true);
      return read();
    });
    const result = await fetchTextWithRetry("https://example.test/data.idx", undefined, {
      fetchFn: vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(complete),
      accessPolicy: { run }, baseDelayMs: 0,
    });
    expect(result.text).toBe("1:0:TMP:850 mb");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
