import { describe, expect, it } from "vitest";
import { GefsEnsembleService } from "../src/core/gefs-ensemble.js";

const run = "2026-08-23T12:00:00Z";
const validTime = "2026-08-23T18:00:00Z";

function serviceFor(values: Record<string, number>, cacheHits: Record<string, boolean> = {}) {
  return new GefsEnsembleService({
    concurrency: 2,
    source: {
      fetch: async (request) => ({ path: request.member, cacheHit: cacheHits[request.member] ?? false }),
    },
    decoder: {
      extractPoint: async (path) => [{
        code: "TMP",
        pressureHpa: 850,
        value: values[path]!,
        gridPoint: { latitude: 50, longitude: 14.5 },
      }],
    },
  });
}

describe("GEFS ensemble service", () => {
  it("returns member values in canonical order and deterministic distribution summaries", async () => {
    const service = serviceFor({ c00: 273.15, p01: 275.15, p02: 277.15, p03: 279.15 }, { p01: true });
    const result = await service.getEnsemble({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p03", "c00", "p02", "p01"],
      quantiles: [0.75, 0.5, 0.25],
      thresholdGte: 3,
    });

    expect(result.members.map((sample) => sample.member)).toEqual(["c00", "p01", "p02", "p03"]);
    expect(result.members.map((sample) => sample.value)).toEqual([0, 2, 4, 6]);
    expect(result.summary).toMatchObject({
      memberCount: 4,
      mean: 3,
      populationStdDev: Math.sqrt(5),
      min: 0,
      max: 6,
      threshold: {
        operator: "gte",
        value: 3,
        count: 2,
        fraction: 0.5,
        interpretation: "raw_member_fraction_not_calibrated_probability",
      },
    });
    expect(result.summary.quantiles).toEqual([
      { quantile: 0.25, value: 1.5 },
      { quantile: 0.5, value: 3 },
      { quantile: 0.75, value: 4.5 },
    ]);
    expect(result.source.allCacheHit).toBe(false);
    expect(result.selection.unit).toBe("degC");
  });

  it("uses the query-aware latest-run provider before sampling members", async () => {
    let requestedMembers: readonly string[] = [];
    const service = new GefsEnsembleService({
      source: { fetch: async (request) => ({ path: request.member, cacheHit: true }) },
      decoder: {
        extractPoint: async () => [{
          code: "HGT",
          pressureHpa: 500,
          value: 5600,
          gridPoint: { latitude: 50, longitude: 14.5 },
        }],
      },
      latestRunProvider: {
        resolveLatestRun: async (_valid, members) => {
          requestedMembers = members;
          return new Date("2026-08-23T12:00:00Z");
        },
      },
    });

    const result = await service.getEnsemble({
      latitude: 50.08,
      longitude: 14.43,
      run: "latest",
      validTime,
      variable: "geopotential_height",
      pressureLevelHpa: 500,
      members: ["p02", "c00"],
      quantiles: [0.5],
    });
    expect(requestedMembers).toEqual(["c00", "p02"]);
    expect(result.run).toBe("2026-08-23T12:00:00.000Z");
  });
});
