import { describe, expect, it } from "vitest";
import { profileDiagnosticsQuerySchema } from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-20T06:00:00Z",
  validTime: "2026-08-20T12:00:00Z",
  pressureLevelsHpa: [900, 850, 800, 750, 700],
  diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
};

describe("profileDiagnosticsQuerySchema", () => {
  it("accepts an explicit sampled profile and defaults to NOMADS", () => {
    expect(profileDiagnosticsQuerySchema.parse(base)).toEqual({ ...base, source: "nomads" });
  });

  it("accepts each whole-profile diagnostic independently", () => {
    for (const diagnostic of ["freezing_level_crossings", "temperature_inversion_layers"]) {
      expect(profileDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: [diagnostic] }).success).toBe(true);
    }
  });

  it("requires at least two distinct published pressure levels", () => {
    expect(profileDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850] }).success).toBe(false);
    expect(profileDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850, 850] }).success).toBe(false);
    expect(profileDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850, 842] }).success).toBe(false);
  });

  it("rejects empty or unknown diagnostics", () => {
    expect(profileDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: [] }).success).toBe(false);
    expect(profileDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: ["magic_profile"] }).success).toBe(false);
  });
});
