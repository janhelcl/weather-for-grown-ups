import { describe, expect, it } from "vitest";
import { layerDiagnosticsQuerySchema } from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-20T06:00:00Z",
  validTime: "2026-08-20T12:00:00Z",
  lowerPressureHpa: 850,
  upperPressureHpa: 700,
  diagnostics: ["temperature_lapse_rate", "wind_shear", "potential_temperature_gradient"],
};

describe("layerDiagnosticsQuerySchema", () => {
  it("accepts an ordered published pressure layer and defaults to NOMADS", () => {
    expect(layerDiagnosticsQuerySchema.parse(base)).toEqual({ ...base, source: "nomads" });
  });

  it("accepts every layer diagnostic independently", () => {
    for (const diagnostic of ["temperature_lapse_rate", "wind_shear", "potential_temperature_gradient"]) {
      expect(layerDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: [diagnostic] }).success).toBe(true);
    }
  });

  it("rejects unknown diagnostics and an empty diagnostic selection", () => {
    expect(layerDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: ["magic_stability"] }).success).toBe(false);
    expect(layerDiagnosticsQuerySchema.safeParse({ ...base, diagnostics: [] }).success).toBe(false);
  });

  it("requires lower altitude to be represented by the higher pressure surface", () => {
    expect(layerDiagnosticsQuerySchema.safeParse({ ...base, lowerPressureHpa: 700, upperPressureHpa: 850 }).success).toBe(false);
    expect(layerDiagnosticsQuerySchema.safeParse({ ...base, lowerPressureHpa: 850, upperPressureHpa: 850 }).success).toBe(false);
  });

  it("rejects pressure surfaces not published by the GFS isobaric product", () => {
    expect(layerDiagnosticsQuerySchema.safeParse({ ...base, lowerPressureHpa: 842 }).success).toBe(false);
  });
});
