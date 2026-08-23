import { describe, expect, it } from "vitest";
import { parcelDiagnosticsQuerySchema } from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-23T06:00:00Z",
  validTime: "2026-08-23T12:00:00Z",
  pressureLevelsHpa: [950, 900, 850, 800, 700, 600, 500, 400, 300],
  parcel: "surface_2m",
};

describe("parcelDiagnosticsQuerySchema", () => {
  it("accepts an explicit parcel query and defaults to NOMADS", () => {
    expect(parcelDiagnosticsQuerySchema.parse(base)).toEqual({ ...base, source: "nomads" });
  });

  it.each(["surface_2m", "mixed_layer_100hpa", "most_unstable_300hpa"])("accepts parcel definition %s", (parcel) => {
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, parcel }).success).toBe(true);
  });

  it("rejects unknown or missing parcel definitions", () => {
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, parcel: "cape" }).success).toBe(false);
    const { parcel: _parcel, ...withoutParcel } = base;
    expect(parcelDiagnosticsQuerySchema.safeParse(withoutParcel).success).toBe(false);
  });

  it("requires at least two distinct published pressure levels", () => {
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850] }).success).toBe(false);
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850, 850] }).success).toBe(false);
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, pressureLevelsHpa: [850, 842] }).success).toBe(false);
  });

  it.each(["nomads", "s3"])("accepts source %s", (source) => {
    expect(parcelDiagnosticsQuerySchema.safeParse({ ...base, source }).success).toBe(true);
  });
});
