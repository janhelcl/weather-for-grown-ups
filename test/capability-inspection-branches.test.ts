import { describe, expect, it } from "vitest";
import { ATMOSPHERIC_OPERATION_IDS } from "../src/catalog/models.js";
import { inspectAtmosphereCapabilities } from "../src/catalog/capability-inspection.js";

const INSTANT = { at: "2026-09-12T12:00:00Z" } as const;
const RANGE = {
  from: "2026-09-12T09:00:00Z",
  to: "2026-09-12T15:00:00Z",
} as const;

describe("capability inspection branch matrix", () => {
  it.each(ATMOSPHERIC_OPERATION_IDS)(
    "classifies canonical operation %s without requiring execution inputs",
    (operation) => {
      const result = inspectAtmosphereCapabilities({ dataset: "gfs", operation });

      expect(result.requested.operation).toBe(operation);
      expect(Array.isArray(result.unsupported)).toBe(true);
    },
  );

  it.each([
    ["point instant", { type: "point", latitude: 50, longitude: 14 }, INSTANT],
    ["point range", { type: "point", latitude: 50, longitude: 14 }, RANGE],
    ["points instant", { type: "points", points: [{ latitude: 50, longitude: 14 }, { latitude: 49, longitude: 15 }] }, INSTANT],
    ["points range", { type: "points", points: [{ latitude: 50, longitude: 14 }, { latitude: 49, longitude: 15 }] }, RANGE],
    ["transect instant", { type: "transect", start: { latitude: 45.8, longitude: 11.7 }, end: { latitude: 46.2, longitude: 12.2 } }, INSTANT],
    ["area instant", { type: "area", westLongitude: 10, eastLongitude: 11, southLatitude: 45, northLatitude: 46 }, INSTANT],
  ] as const)("infers the operation for %s", (_label, geometry, time) => {
    const result = inspectAtmosphereCapabilities({ dataset: "gfs", geometry, time });

    expect(result.supported).toBe(true);
    expect(result.requested.operation).toBeUndefined();
  });

  it("infers layer diagnostics when operation is omitted", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
    });

    expect(result.supported).toBe(true);
  });

  it("infers profile diagnostics when operation is omitted", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700, 500],
        diagnostics: ["temperature_inversion_layers"],
      },
    });

    expect(result.supported).toBe(true);
  });

  it("infers parcel diagnostics when operation is omitted", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        parcel: "surface_2m",
      },
    });

    expect(result.supported).toBe(true);
  });

  it("infers diagnostic timeseries for ranged diagnostic evidence", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      time: RANGE,
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
    });

    expect(result.supported).toBe(true);
  });

  it("covers valid field-only area selection", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "area_summary",
      geometry: { type: "area", westLongitude: 10, eastLongitude: 11, southLatitude: 45, northLatitude: 46 },
      time: INSTANT,
      selection: { fields: ["temperature_2m"] },
    });

    expect(result.supported).toBe(true);
  });

  it("covers valid pressure-only area selection", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs",
      operation: "area_summary",
      geometry: { type: "area", westLongitude: 10, eastLongitude: 11, southLatitude: 45, northLatitude: 46 },
      time: INSTANT,
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.supported).toBe(true);
  });

  it.each([
    ["gfs", 850],
    ["aigfs", 850],
    ["aigefs", 850],
    ["hgefs", 850],
    ["icon-d2", 850],
    ["icon-d2-eps", 850],
    ["ifs", 850],
    ["ifs-ens", 850],
    ["aifs", 850],
    ["aifs-ens", 850],
  ] as const)("uses declared pressure levels for %s", (dataset, level) => {
    const result = inspectAtmosphereCapabilities({
      dataset,
      selection: { variables: ["temperature"], pressureLevelsHpa: [level] },
    });

    expect(result.unsupported.some((issue) => issue.reason.includes("does not expose pressure levels"))).toBe(false);
  });

  it("leaves datasets without a static pressure-level table to their catalog contract", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "arome",
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.unsupported.some((issue) => issue.reason.includes("does not expose pressure levels"))).toBe(false);
  });

  it("accepts a supported GEFS variable-level pairing", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gefs",
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.supported).toBe(true);
  });

  it("reports a geometry unsupported by a dataset operation surface", () => {
    const result = inspectAtmosphereCapabilities({
      dataset: "gfs-analysis",
      operation: "ensemble_distribution",
      geometry: { type: "point", latitude: 50, longitude: 14 },
    });

    expect(result.supported).toBe(false);
    expect(result.unsupported.some((issue) => issue.path[0] === "operation")).toBe(true);
  });
});
