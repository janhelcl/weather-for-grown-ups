import { describe, expect, it } from "vitest";
import { gefsEnsembleQuerySchema } from "../src/schema/gefs-ensemble.js";

const base = {
  latitude: 50,
  longitude: 14,
  validTime: "2026-08-24T03:00:00Z",
  members: ["c00", "p01"] as const,
};

describe("GEFS ensemble field selection schema", () => {
  it("accepts one raw non-isobaric field", () => {
    const parsed = gefsEnsembleQuerySchema.parse({ ...base, field: "cape_180mb" });
    expect(parsed.field).toBe("cape_180mb");
    expect(parsed.variable).toBeUndefined();
  });

  it("rejects field plus pressure selection", () => {
    expect(() => gefsEnsembleQuerySchema.parse({
      ...base,
      field: "temperature_2m",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow();
  });

  it("rejects incomplete pressure selection and derived field ids", () => {
    expect(() => gefsEnsembleQuerySchema.parse({ ...base, variable: "temperature" })).toThrow();
    expect(() => gefsEnsembleQuerySchema.parse({ ...base, field: "wind_10m" })).toThrow();
  });
});
