import { describe, expect, it, vi } from "vitest";
import { IfsEnsLatestRunResolver } from "../src/core/ifs-ens-latest-run.js";

const selectors = [{
  key: "temperature@850#member50",
  param: "t",
  levtype: "pl" as const,
  levelist: 850,
  number: 50,
}];

describe("IFS ENS latest run resolution", () => {
  it("uses the ENS short-cycle horizon rather than deterministic IFS limits", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new IfsEnsLatestRunResolver({
      probe: { isForecastAvailable },
      now: () => new Date("2026-08-27T18:00:00Z"),
    });

    const validTime = new Date("2026-08-31T18:00:00Z");
    const run = await resolver.resolveLatestRun(validTime, selectors);

    expect(run.toISOString()).toBe("2026-08-27T18:00:00.000Z");
    expect(isForecastAvailable).toHaveBeenCalledOnce();
    expect(isForecastAvailable).toHaveBeenCalledWith(run, 96, selectors);
  });

  it("skips an 18Z candidate beyond f144 and falls back to a long ENS cycle", async () => {
    const isForecastAvailable = vi.fn(async () => true);
    const resolver = new IfsEnsLatestRunResolver({
      probe: { isForecastAvailable },
      now: () => new Date("2026-08-27T18:00:00Z"),
    });

    const validTime = new Date("2026-09-03T00:00:00Z");
    const run = await resolver.resolveLatestRun(validTime, selectors);

    expect(run.toISOString()).toBe("2026-08-27T12:00:00.000Z");
    expect(isForecastAvailable).toHaveBeenCalledOnce();
    expect(isForecastAvailable).toHaveBeenCalledWith(run, 156, selectors);
  });
});
