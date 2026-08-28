import { describe, expect, it } from "vitest";
import {
  ifsEnsLayerDiagnosticsQuerySchema,
  ifsEnsParcelDiagnosticsQuerySchema,
  ifsEnsProfileDiagnosticsQuerySchema,
} from "../src/schema/ifs-ens-diagnostics.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "latest" as const,
  validTime: "2026-08-28T12:00:00Z",
};

describe("IFS ENS diagnostic schemas", () => {
  it("defaults to all 50 perturbations and compact summaries", () => {
    const query = ifsEnsLayerDiagnosticsQuerySchema.parse({
      ...base,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear"],
    });
    expect(query.members).toHaveLength(50);
    expect(query.members[0]).toBe("p01");
    expect(query.members[49]).toBe("p50");
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.includeMembers).toBe(false);
  });

  it("reuses deterministic IFS diagnostic selection validation", () => {
    expect(() => ifsEnsLayerDiagnosticsQuerySchema.parse({
      ...base,
      lowerPressureHpa: 500,
      upperPressureHpa: 850,
      diagnostics: ["wind_shear"],
      members: ["p01", "p02"],
    })).toThrow("lowerPressureHpa must be greater than upperPressureHpa");

    expect(() => ifsEnsProfileDiagnosticsQuerySchema.parse({
      ...base,
      pressureLevelsHpa: [850, 850],
      diagnostics: ["freezing_level_crossings"],
      members: ["p01", "p02"],
    })).toThrow("pressure levels must not contain duplicates");

    expect(() => ifsEnsParcelDiagnosticsQuerySchema.parse({
      ...base,
      pressureLevelsHpa: [850, 850],
      parcel: "surface_2m",
      members: ["p01", "p02"],
    })).toThrow("pressure levels must not contain duplicates");
  });

  it("rejects duplicate ensemble selectors", () => {
    expect(() => ifsEnsLayerDiagnosticsQuerySchema.parse({
      ...base,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear"],
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsProfileDiagnosticsQuerySchema.parse({
      ...base,
      pressureLevelsHpa: [850, 500],
      diagnostics: ["freezing_level_crossings"],
      members: ["p01", "p02"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });
});
