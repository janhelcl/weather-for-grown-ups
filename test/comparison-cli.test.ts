import { describe, expect, it } from "vitest";
import { buildUnifiedDatasetComparison } from "../src/cli/unified-atmosphere-command.js";

const base = {
  lat: 50,
  lon: 14,
  at: "2026-08-31T06:00:00.000Z",
  var: "temperature",
  level: 850,
  run: "2026-08-31T00:00:00.000Z",
};

describe("comparison CLI request builder", () => {
  it.each([
    ["gfs", "gefs"],
    ["gfs", "ifs"],
    ["gefs", "ifs-ens"],
    ["ifs", "ifs-ens"],
    ["gfs", "aigfs"],
    ["ifs", "aifs"],
    ["aigfs", "aifs"],
    ["gefs", "aigefs"],
    ["ifs-ens", "aifs-ens"],
    ["hgefs", "gefs"],
    ["hgefs", "aigefs"],
  ] as const)("builds the registered %s:%s pair", (dataset, against) => {
    const request: any = buildUnifiedDatasetComparison({
      ...base,
      dataset,
      against,
    });
    expect(request.datasets).toEqual([dataset, against]);
    expect(request.geometry).toEqual({ type: "point", latitude: 50, longitude: 14 });
    expect(request.time).toEqual({ at: base.at });
  });

  it("preserves pair-specific controls without leaking them across pairs", () => {
    const noaa: any = buildUnifiedDatasetComparison({
      ...base,
      dataset: "gefs",
      against: "aigefs",
      gefsMembers: "c00,p01",
      aigefsMembers: "c00,p01",
      quantiles: "0.1,0.5,0.9",
      gte: 10,
    });
    expect(noaa.gefsMembers).toEqual(["c00", "p01"]);
    expect(noaa.aigefsMembers).toEqual(["c00", "p01"]);
    expect(noaa.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(noaa.thresholdGte).toBe(10);

    const ecmwf: any = buildUnifiedDatasetComparison({
      ...base,
      dataset: "ifs-ens",
      against: "aifs-ens",
      ifsEnsMembers: "p01,p02",
      aifsEnsMembers: "c00,p01",
      quantiles: "0.5",
      gte: 5,
    });
    expect(ecmwf.ifsEnsMembers).toEqual(["p01", "p02"]);
    expect(ecmwf.aifsEnsMembers).toEqual(["c00", "p01"]);

    const hybrid: any = buildUnifiedDatasetComparison({
      ...base,
      dataset: "hgefs",
      against: "gefs",
      hgefsMembers: "gefs:c00,gefs:p01,aigefs:c00,aigefs:p01",
      quantiles: "0.5",
      gte: 8,
    });
    expect(hybrid.hgefsMembers).toHaveLength(4);
    expect(hybrid.thresholdGte).toBe(8);
  });

  it("keeps legacy default pair selection", () => {
    expect(buildUnifiedDatasetComparison({ ...base, against: "gefs" }).datasets)
      .toEqual(["gfs", "gefs"]);
    expect(buildUnifiedDatasetComparison({ ...base, against: "ifs-ens" }).datasets)
      .toEqual(["gefs", "ifs-ens"]);
  });

  it("rejects invalid and unregistered pair requests before execution", () => {
    expect(() => buildUnifiedDatasetComparison({
      ...base,
      dataset: "bogus",
      against: "gefs",
    })).toThrow("Expected --dataset");

    expect(() => buildUnifiedDatasetComparison({
      ...base,
      dataset: "gfs",
      against: "bogus",
    })).toThrow("Expected --against");

    expect(() => buildUnifiedDatasetComparison({
      ...base,
      dataset: "gfs",
      against: "aifs",
    })).toThrow("Unsupported comparison pair");
  });
});
