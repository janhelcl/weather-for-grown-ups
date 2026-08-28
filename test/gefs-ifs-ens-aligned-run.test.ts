import { describe, expect, it, vi } from "vitest";
import { GefsIfsEnsAlignedRunResolver } from "../src/core/gefs-ifs-ens-aligned-run.js";

describe("GEFS / IFS ENS aligned run resolver", () => {
  it("walks common cycles until both requested ensemble subsets are available", async () => {
    const gefsProbe = {
      areMembersAvailable: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const ifsEnsProbe = {
      isForecastAvailable: vi.fn().mockResolvedValue(true),
    };
    const resolver = new GefsIfsEnsAlignedRunResolver({
      gefsProbe,
      ifsEnsProbe,
      now: () => new Date("2026-08-28T12:30:00Z"),
      maxCandidates: 4,
    });

    const run = await resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T12:00:00Z"),
      "temperature",
      850,
      ["c00", "p01"],
      ["p01", "p50"],
    );

    expect(run.toISOString()).toBe("2026-08-28T06:00:00.000Z");
    expect(gefsProbe.areMembersAvailable).toHaveBeenNthCalledWith(
      1,
      new Date("2026-08-28T12:00:00.000Z"),
      0,
      ["c00", "p01"],
    );
    expect(gefsProbe.areMembersAvailable).toHaveBeenNthCalledWith(
      2,
      new Date("2026-08-28T06:00:00.000Z"),
      6,
      ["c00", "p01"],
    );
    expect(ifsEnsProbe.isForecastAvailable).toHaveBeenCalledTimes(2);
    expect(ifsEnsProbe.isForecastAvailable).toHaveBeenLastCalledWith(
      new Date("2026-08-28T06:00:00.000Z"),
      6,
      expect.arrayContaining([
        expect.objectContaining({ param: "t", levtype: "pl", levelist: 850, number: 1 }),
        expect.objectContaining({ param: "t", levtype: "pl", levelist: 850, number: 50 }),
      ]),
    );
  });

  it("fails explicitly when no common published cycle can satisfy the request", async () => {
    const resolver = new GefsIfsEnsAlignedRunResolver({
      gefsProbe: { areMembersAvailable: vi.fn(async () => true) },
      ifsEnsProbe: { isForecastAvailable: vi.fn(async () => false) },
      now: () => new Date("2026-08-28T12:30:00Z"),
      maxCandidates: 2,
    });

    await expect(resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T12:00:00Z"),
      "temperature",
      850,
      ["c00", "p01"],
      ["p01", "p02"],
    )).rejects.toThrow("No aligned GEFS/IFS ENS cycle");
  });

  it("skips cycles that violate IFS ENS native cadence", async () => {
    const gefsProbe = { areMembersAvailable: vi.fn(async () => true) };
    const ifsEnsProbe = { isForecastAvailable: vi.fn(async () => true) };
    const resolver = new GefsIfsEnsAlignedRunResolver({
      gefsProbe,
      ifsEnsProbe,
      now: () => new Date("2026-08-28T00:00:00Z"),
      maxCandidates: 2,
    });

    await expect(resolver.resolveLatestAlignedRun(
      new Date("2026-08-28T01:00:00Z"),
      "temperature",
      850,
      ["c00", "p01"],
      ["p01", "p02"],
    )).rejects.toThrow("No aligned GEFS/IFS ENS cycle");

    expect(gefsProbe.areMembersAvailable).not.toHaveBeenCalled();
    expect(ifsEnsProbe.isForecastAvailable).not.toHaveBeenCalled();
  });
});
