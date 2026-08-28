import { describe, expect, it } from "vitest";
import {
  IFS_ENS_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES,
  IFS_ENS_TIME_SERIES_DEFAULT_MAX_STEPS,
  ifsEnsTimeSeriesQuerySchema,
} from "../src/schema/ifs-ens-timeseries.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "latest" as const,
  startTime: "2026-08-28T00:00:00Z",
  endTime: "2026-08-28T12:00:00Z",
  selection: { fields: ["wind_10m"] as const },
};

describe("IFS ENS time-series schema", () => {
  it("defaults to all 50 perturbations with compact member payloads", () => {
    const query = ifsEnsTimeSeriesQuerySchema.parse(base);
    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.includeMembers).toBe(false);
    expect(query.maxSteps).toBe(IFS_ENS_TIME_SERIES_DEFAULT_MAX_STEPS);
    expect(query.maxMemberSamples).toBe(IFS_ENS_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES);
  });

  it("rejects reversed ranges", () => {
    expect(() => ifsEnsTimeSeriesQuerySchema.parse({
      ...base,
      startTime: "2026-08-28T12:00:00Z",
      endTime: "2026-08-28T00:00:00Z",
    })).toThrow("endTime must be at or after startTime");
  });

  it("rejects duplicate members and quantiles", () => {
    expect(() => ifsEnsTimeSeriesQuerySchema.parse({
      ...base,
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsTimeSeriesQuerySchema.parse({
      ...base,
      members: ["p01", "p50"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });
});
