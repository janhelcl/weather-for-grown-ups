import { describe, expect, it, vi } from "vitest";
import { lazyAsync } from "../src/util/lazy-async.js";

describe("lazy initialization", () => {
  it("shares one pending initialization and the successful instance", async () => {
    const instance = {};
    const load = vi.fn(async () => instance);
    const get = lazyAsync(load);
    expect(load).not.toHaveBeenCalled();
    const first = get();
    expect(get()).toBe(first);
    expect(await first).toBe(instance);
    expect(await get()).toBe(instance);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("retries initialization after failure (synchronous=%s)", async (synchronous) => {
    const error = new Error("initialization failed");
    const instance = {};
    const load = vi.fn(() => {
      if (load.mock.calls.length > 1) return Promise.resolve(instance);
      if (synchronous) throw error;
      return Promise.reject(error);
    });
    const get = lazyAsync(load);
    const first = get();
    const concurrent = get();
    await expect(first).rejects.toBe(error);
    await expect(concurrent).rejects.toBe(error);
    expect(await get()).toBe(instance);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
