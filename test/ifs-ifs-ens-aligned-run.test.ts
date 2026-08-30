import { describe, expect, it, vi } from "vitest";
import { IfsIfsEnsAlignedRunResolver } from "../src/core/ifs-ifs-ens-aligned-run.js";

describe("IFS / IFS ENS aligned run resolver", () => {
  it("walks shared ECMWF cycles until control and requested perturbations are available", async () => {
    const ifsProbe = {
      isForecastAvailable: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const ifsEnsProbe = {
      isForecastAvailable: vi.fn().mockResolvedValue(true),
    };
    const resolver = new IfsIfsEnsAlignedRunResolver({
      ifsProbe,
      ifsEnsProbe,
      now: () => new Date("2026-08-28T12:30:00Z"),
      maxCandidates: 4,
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T12:00:00Z"),
      "temperature",
      850,
      ["p01", "p50"],
    );

    expect(run.toISOString()).toBe("2026-08-28T06:00:00.000Z");
    expect(ifsProbe.isForecastAvailable).toHaveBeenNthCalledWith(
      1,
      new Date("2026-08-28T12:00:00.000Z"),
      0,
      [expect.objectContaining({ param: "t", levtype: "pl", levelist: 850 })],
    );
    expect(ifsProbe.isForecastAvailable).toHaveBeenNthCalledWith(
      2,
      new Date("2026-08-28T06:00:00.000Z"),
      6,
      [expect.objectContaining({ param: "t", levtype: "pl", levelist: 850 })],
    );
    expect(ifsEnsProbe.isForecastAvailable).toHaveBeenLastCalledWith(
      new Date("2026-08-28T06:00:00.000Z"),
      6,
      expect.arrayContaining([
        expect.objectContaining({ param: "t", levtype: "pl", levelist: 850, number: 1 }),
        expect.objectContaining({ param: "t", levtype: "pl", levelist: 850, number: 50 }),
      ]),
    );
  });

  it("probes raw dependencies for derived scalar comparisons", async () => {
    const deterministicSelectors: string[][] = [];
    const ensembleSelectors: Array<Array<{ param: string; number?: number }>> = [];
    const resolver = new IfsIfsEnsAlignedRunResolver({
      ifsProbe: {
        isForecastAvailable: async (_run, _hour, selectors) => {
          deterministicSelectors.push(selectors.map((selector) => selector.param));
          return true;
        },
      },
      ifsEnsProbe: {
        isForecastAvailable: async (_run, _hour, selectors) => {
          ensembleSelectors.push(selectors.map((selector) => ({
            param: selector.param,
            number: selector.number,
          })));
          return true;
        },
      },
      now: () => new Date("2026-08-28T12:30:00Z"),
    });

    await resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T12:00:00Z"),
      "dew_point",
      850,
      ["p01", "p02"],
    );

    expect(deterministicSelectors[0]).toEqual(["t", "r"]);
    expect(ensembleSelectors[0]).toEqual(expect.arrayContaining([
      { param: "t", number: 1 },
      { param: "r", number: 1 },
      { param: "t", number: 2 },
      { param: "r", number: 2 },
    ]));
  });

  it("skips a short deterministic IFS cycle that cannot reach the valid time", async () => {
    const deterministicRuns: string[] = [];
    const ensembleRuns: string[] = [];
    const resolver = new IfsIfsEnsAlignedRunResolver({
      ifsProbe: {
        isForecastAvailable: async (run) => {
          deterministicRuns.push(run.toISOString());
          return true;
        },
      },
      ifsEnsProbe: {
        isForecastAvailable: async (run) => {
          ensembleRuns.push(run.toISOString());
          return true;
        },
      },
      now: () => new Date("2026-08-28T06:00:00Z"),
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-09-03T12:00:00Z"),
      "temperature",
      850,
      ["p01", "p02"],
    );

    expect(run.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(deterministicRuns).toEqual(["2026-08-28T00:00:00.000Z"]);
    expect(ensembleRuns).toEqual(["2026-08-28T00:00:00.000Z"]);
  });

  it("fails explicitly when no shared cycle publishes both branches", async () => {
    const resolver = new IfsIfsEnsAlignedRunResolver({
      ifsProbe: { isForecastAvailable: vi.fn(async () => true) },
      ifsEnsProbe: { isForecastAvailable: vi.fn(async () => false) },
      now: () => new Date("2026-08-28T12:30:00Z"),
      maxCandidates: 2,
    });

    await expect(resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T12:00:00Z"),
      "temperature",
      850,
      ["p01", "p02"],
    )).rejects.toThrow("No aligned deterministic IFS/IFS ENS cycle");
  });
});
