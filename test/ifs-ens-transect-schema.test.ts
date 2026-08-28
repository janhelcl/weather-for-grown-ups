import { describe, expect, it } from "vitest";
import {
  IFS_ENS_DEFAULT_TRANSECT_SAMPLES,
  IFS_ENS_MAX_TRANSECT_SAMPLES,
  ifsEnsTransectQuerySchema,
} from "../src/schema/ifs-ens-transect.js";

const base = {
  start: { latitude: 49.8, longitude: 14.0 },
  end: { latitude: 50.3, longitude: 15.0 },
  run: "latest" as const,
  validTime: "2026-08-28T12:00:00Z",
  selection: {
    variables: ["temperature" as const],
    pressureLevelsHpa: [850 as const],
  },
};

describe("IFS ENS transect schema", () => {
  it("defaults to all perturbations and twenty great-circle samples", () => {
    const query = ifsEnsTransectQuerySchema.parse(base);
    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.samples).toBe(IFS_ENS_DEFAULT_TRANSECT_SAMPLES);
  });

  it("rejects degenerate paths and samples beyond the multi-point bound", () => {
    expect(() => ifsEnsTransectQuerySchema.parse({
      ...base,
      end: base.start,
    })).toThrow("Transect start and end coordinates must differ");

    expect(() => ifsEnsTransectQuerySchema.parse({
      ...base,
      samples: IFS_ENS_MAX_TRANSECT_SAMPLES + 1,
    })).toThrow();
  });

  it("rejects duplicate member and quantile selectors", () => {
    expect(() => ifsEnsTransectQuerySchema.parse({
      ...base,
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsTransectQuerySchema.parse({
      ...base,
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });
});
