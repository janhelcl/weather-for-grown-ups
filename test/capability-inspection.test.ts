import { describe, expect, it } from "vitest";
import { inspectAtmosphereCapabilities } from "../src/catalog/capability-inspection.js";
import { capabilityInspectionResultSchema } from "../src/schema/capability-inspection.js";

describe("inspectAtmosphereCapabilities", () => {
  it("returns a compact positive decision with canonical model metadata", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "transect",
      geometry: {
        type: "transect",
        start: { latitude: 45.8, longitude: 11.7 },
        end: { latitude: 46.2, longitude: 12.2 },
      },
      time: { at: "2026-09-12T12:00:00Z" },
      selection: { variables: ["temperature", "u_wind"], pressureLevelsHpa: [850, 700] },
    });

    expect(result).toMatchObject({
      basis: "declared_capability",
      dataset: "gfs",
      supported: true,
      unsupported: [],
      capabilities: {
        kind: "deterministic",
        provider: "noaa",
        spatialDomain: { scope: "global" },
      },
    });
    expect(result.geometries).toEqual(expect.arrayContaining(["point", "points", "transect", "area"]));
    expect(capabilityInspectionResultSchema.parse(result)).toEqual(result);
  });

  it("reports exact unsupported selections instead of requiring trial retrieval", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "arome",
      selection: { fields: ["definitely_not_a_field"] },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["selection", "fields"],
        reason: expect.stringContaining("definitely_not_a_field"),
      }),
    ]));
  });

  it("reports declared pressure-level restrictions before retrieval", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "aigfs",
      selection: { variables: ["temperature"], pressureLevelsHpa: [975] },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported.some((issue) =>
      issue.path.join(".").includes("pressureLevelsHpa") && issue.reason.includes("975")
    )).toBe(true);
  });

  it("checks limited-area domain coverage without touching a provider", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 0, longitude: 0 },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["geometry"],
        reason: expect.stringContaining("does not fully cover"),
      }),
    ]));
  });

  it("rejects an operation/geometry mismatch even when both are supported separately", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "profile",
      geometry: {
        type: "area",
        westLongitude: 10,
        eastLongitude: 11,
        southLatitude: 45,
        northLatitude: 46,
      },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["geometry", "type"],
        reason: expect.stringContaining("operation=profile requires geometry=point"),
      }),
    ]));
  });

  it("rejects an operation/time-shape mismatch", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "profile",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2026-09-12T09:00:00Z",
        to: "2026-09-12T15:00:00Z",
      },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["time"],
        reason: expect.stringContaining("operation=profile requires instant valid time"),
      }),
    ]));
  });

  it("rejects a diagnostic selection on a raw-state operation", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "profile",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: ["temperature_inversion_layers"],
      },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["diagnostic"],
        reason: expect.stringContaining("operation=profile does not consume a diagnostic selection"),
      }),
    ]));
  });

  it("rejects the wrong diagnostic family for an explicit diagnostic operation", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "profile_diagnostics",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["bulk_shear"],
      },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["diagnostic", "kind"],
        reason: expect.stringContaining("requires diagnostic.kind=profile"),
      }),
    ]));
  });

  it("checks area selection cardinality without fetching data", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "area_summary",
      geometry: {
        type: "area",
        westLongitude: 10,
        eastLongitude: 11,
        southLatitude: 45,
        northLatitude: 46,
      },
      selection: {
        variables: ["temperature", "u_wind"],
        pressureLevelsHpa: [850],
      },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["selection"],
        reason: expect.stringContaining("area geometry requires exactly one pressure variable"),
      }),
    ]));
  });

  it("checks GEFS variable-specific pressure levels", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gefs",
      selection: { variables: ["vertical_velocity"], pressureLevelsHpa: [700] },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["selection", "pressureLevelsHpa"],
        reason: expect.stringContaining("vertical_velocity at 700 hPa"),
      }),
    ]));
  });

  it("reports invalid source overrides as a focused modifier issue", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "ifs",
      source: "s3",
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["source"],
        reason: expect.stringContaining("source override is only valid for gfs"),
      }),
    ]));
  });

  it("reports unsupported GFS source routing for an area", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      geometry: {
        type: "area",
        westLongitude: 10,
        eastLongitude: 11,
        southLatitude: 45,
        northLatitude: 46,
      },
      source: "s3",
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["source"],
        reason: expect.stringContaining("area queries use NOMADS"),
      }),
    ]));
  });

  it("keeps static capability distinct from live reforecast availability", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gefs",
      forecast: { kind: "reforecast" },
      operation: "profile",
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.supported).toBe(true);
    expect(result.basis).toBe("declared_capability");
    expect(result.requested.forecast).toEqual({ kind: "reforecast" });
  });

  it("reports invalid reforecast dataset selection before retrieval", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      forecast: { kind: "reforecast" },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["forecast", "kind"],
        reason: expect.stringContaining("only for dataset=gefs"),
      }),
    ]));
  });

  it("reports deterministic-versus-ensemble modifier mistakes as focused issues", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      ensemble: { members: ["c00", "p01"] },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported.some((issue) => issue.path.join(".").startsWith("ensemble"))).toBe(true);
  });

  it("checks exact diagnostic family support from the same catalog vocabulary", () => {
    const supported = inspectAtmosphereCapabilities({
      dataset: "ifs",
      operation: "profile_diagnostics",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: ["temperature_inversion_layers"],
      },
    });
    const unsupported = inspectAtmosphereCapabilities({
      dataset: "arome",
      operation: "profile_diagnostics",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: ["temperature_inversion_layers"],
      },
    });

    expect(supported.supported).toBe(true);
    expect(unsupported.supported).toBe(false);
    expect(unsupported.unsupported.some((issue) =>
      issue.reason.includes("pressure-based diagnostics") || issue.reason.includes("operation=profile_diagnostics")
    )).toBe(true);
  });
});
