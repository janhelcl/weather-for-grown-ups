import { describe, expect, it } from "vitest";
import { gefsParcelDiagnosticsQuerySchema } from "../src/schema/gefs-parcel-diagnostics.js";

const base = {
  latitude: 50,
  longitude: 14,
  run: "2026-08-24T00:00:00Z",
  validTime: "2026-08-24T06:00:00Z",
  pressureLevelsHpa: [925, 850, 700, 500],
  parcel: "surface_2m" as const,
  members: ["c00", "p01"] as const,
};

describe("GEFS parcel diagnostics schema", () => {
  it("applies ensemble defaults", () => {
    const parsed = gefsParcelDiagnosticsQuerySchema.parse(base);
    expect(parsed.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(parsed.includeMembers).toBe(false);
  });

  it("rejects levels without the common T/RH/HGT pgrb2a dependency set", () => {
    expect(() => gefsParcelDiagnosticsQuerySchema.parse({ ...base, pressureLevelsHpa: [925, 300] })).toThrow();
  });

  it("rejects duplicate members, levels and quantiles", () => {
    expect(() => gefsParcelDiagnosticsQuerySchema.parse({ ...base, members: ["c00", "c00"] })).toThrow();
    expect(() => gefsParcelDiagnosticsQuerySchema.parse({ ...base, pressureLevelsHpa: [925, 925] })).toThrow();
    expect(() => gefsParcelDiagnosticsQuerySchema.parse({ ...base, quantiles: [0.5, 0.5] })).toThrow();
  });
});
