import { describe, expect, it, vi } from "vitest";
import { IfsLatestRunResolver } from "../src/core/ifs-latest-run.js";

const selectors = [{ key: "temperature@850", param: "t", levtype: "pl" as const, levelist: 850 }];

describe("IFS latest run resolution", () => {
  it("selects the newest native cycle that actually contains the requested selection", async () => {
    const isForecastAvailable = vi.fn(async (run: Date) => run.toISOString() === "2026-08-27T12:00:00.000Z");
    const resolver = new IfsLatestRunResolver({
      probe: { isForecastAvailable },
      now: () => new Date("2026-08-27T19:00:00Z"),
    });

    const result = await resolver.resolveLatestRun(new Date("2026-08-27T21:00:00Z"), selectors);
    expect(result.toISOString()).toBe("2026-08-27T12:00:00.000Z");
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-27T18:00:00.000Z"),
      3,
      selectors,
    );
    expect(isForecastAvailable).toHaveBeenCalledWith(
      new Date("2026-08-27T12:00:00.000Z"),
      9,
      selectors,
    );
  });

  it("skips candidate cycles whose native horizon cannot reach the valid time", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new IfsLatestRunResolver({
      probe: { isForecastAvailable },
      now: () => new Date("2026-08-27T18:00:00Z"),
    });
    const validTime = new Date("2026-09-02T00:00:00Z");
    const run = await resolver.resolveLatestRun(validTime, selectors);
    expect([0, 12]).toContain(run.getUTCHours());
    expect(isForecastAvailable).toHaveBeenCalled();
  });
});
