import { describe, expect, it } from "vitest";
import {
  IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS,
  ifsEnsDiagnosticTimeSeriesQuerySchema,
} from "../src/schema/ifs-ens-diagnostic-timeseries.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "latest" as const,
  startTime: "2026-08-28T00:00:00Z",
  endTime: "2026-08-28T12:00:00Z",
  diagnostic: {
    kind: "layer" as const,
    lowerPressureHpa: 850,
    upperPressureHpa: 500,
    diagnostics: ["wind_shear" as const],
  },
};

describe("IFS ENS diagnostic time-series schema", () => {
  it("defaults to all perturbations, compact summaries, and bounded native steps", () => {
    const query = ifsEnsDiagnosticTimeSeriesQuerySchema.parse(base);
    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.maxSteps).toBe(IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS);
  });

  it("rejects reversed time ranges and duplicate ensemble selectors", () => {
    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      startTime: "2026-08-28T12:00:00Z",
      endTime: "2026-08-28T00:00:00Z",
    })).toThrow("endTime must be at or after startTime");

    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });

  it("reuses instant IFS ENS diagnostic validation for every diagnostic kind", () => {
    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 500,
        upperPressureHpa: 850,
        diagnostics: ["wind_shear"],
      },
    })).toThrow("lowerPressureHpa must be greater than upperPressureHpa");

    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 850],
        diagnostics: ["freezing_level_crossings"],
      },
    })).toThrow("pressure levels must not contain duplicates");

    expect(() => ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
      ...base,
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [850, 850],
        parcel: "surface_2m",
      },
    })).toThrow("pressure levels must not contain duplicates");
  });
});
