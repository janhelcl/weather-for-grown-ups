import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../src/core/concurrency.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapConcurrent", () => {
  it("preserves input order even when work finishes out of order", async () => {
    const result = await mapConcurrent([30, 5, 15], 3, async (ms) => {
      await delay(ms);
      return ms * 2;
    });
    expect(result).toEqual([60, 10, 30]);
  });

  it("never exceeds the configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
      return value;
    });
    expect(maxActive).toBe(2);
  });

  it("uses no more workers than there are values", async () => {
    let active = 0;
    let maxActive = 0;
    await mapConcurrent([1, 2], 20, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
      return value;
    });
    expect(maxActive).toBe(2);
  });

  it("returns an empty result for empty input", async () => {
    await expect(mapConcurrent([], 4, async (value) => value)).resolves.toEqual([]);
  });

  it.each([0, -1, 1.5])("rejects invalid concurrency %s", async (concurrency) => {
    await expect(mapConcurrent([1], concurrency, async (value) => value)).rejects.toThrow(/positive integer/);
  });

  it("propagates mapper failures", async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error("boom");
        return value;
      }),
    ).rejects.toThrow("boom");
  });
});
