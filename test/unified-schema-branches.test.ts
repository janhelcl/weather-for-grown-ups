import { describe, expect, it } from "vitest";
import {
  atmosphericEnsembleOptionsSchema,
  atmosphericGeometrySchema,
  atmosphericRangeTimeSchema,
  atmosphericSelectionSchema,
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const pressureSelection = {
  variables: ["temperature"],
  pressureLevelsHpa: [850],
};

describe("unified atmospheric schema capability branches", () => {
  it("rejects degenerate transects and malformed areas", () => {
    expect(() => atmosphericGeometrySchema.parse({
      type: "transect",
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 50, longitude: 14 },
    })).toThrow("Transect start and end coordinates must differ");

    expect(() => atmosphericGeometrySchema.parse({
      type: "area",
      westLongitude: 15,
      eastLongitude: 14,
      southLatitude: 49,
      northLatitude: 50,
    })).toThrow("eastLongitude must be greater");

    expect(() => atmosphericGeometrySchema.parse({
      type: "area",
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 50,
      northLatitude: 49,
    })).toThrow("northLatitude must be greater");
  });

  it("validates historical range ordering and cycle uniqueness", () => {
    expect(() => atmosphericRangeTimeSchema.parse({
      from: "2017-05-10T00:00:00Z",
      to: "2017-05-09T00:00:00Z",
    })).toThrow("to must be at or after from");

    expect(() => atmosphericRangeTimeSchema.parse({
      from: "2017-05-09T00:00:00Z",
      to: "2017-05-10T00:00:00Z",
      hoursUtc: [0, 0],
    })).toThrow("hoursUtc must not contain duplicates");
  });

  it("validates pressure selection pairing and duplicate values", () => {
    expect(() => atmosphericSelectionSchema.parse({
      variables: ["temperature"],
    })).toThrow("must be supplied together");

    expect(() => atmosphericSelectionSchema.parse({
      pressureLevelsHpa: [850],
    })).toThrow("must be supplied together");

    expect(() => atmosphericSelectionSchema.parse({}))
      .toThrow("Request at least one pressure-level variable");

    expect(() => atmosphericSelectionSchema.parse({
      variables: ["temperature", "temperature"],
      pressureLevelsHpa: [850],
    })).toThrow("variables must not contain duplicates");

    expect(() => atmosphericSelectionSchema.parse({
      variables: ["temperature"],
      pressureLevelsHpa: [850, 850],
    })).toThrow("pressureLevelsHpa must not contain duplicates");

    expect(() => atmosphericSelectionSchema.parse({
      fields: ["wind_10m", "wind_10m"],
    })).toThrow("fields must not contain duplicates");
  });

  it("validates duplicate ensemble controls", () => {
    expect(() => atmosphericEnsembleOptionsSchema.parse({
      members: ["c00", "c00"],
    })).toThrow("members must not contain duplicates");

    expect(() => atmosphericEnsembleOptionsSchema.parse({
      quantiles: [0.5, 0.5],
    })).toThrow("quantiles must not contain duplicates");
  });

  it("rejects cross-dataset modifiers and misplaced aggregation", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
        hoursUtc: [0],
      },
      selection: pressureSelection,
    })).toThrow("hoursUtc is only valid for gfs-analysis ranges");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: pressureSelection,
      source: "s3",
    })).toThrow("source override is only valid for operational gfs");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: pressureSelection,
      aggregate: { percentiles: [50] },
    })).toThrow("aggregate is only valid for area geometry");
  });

  it("accepts either scalar area selection form and rejects area ranges", () => {
    const geometry = {
      type: "area" as const,
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 50,
    };

    expect(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: pressureSelection,
    }).selection).toEqual(pressureSelection);

    expect(queryAtmosphereSchema.parse({
      dataset: "gfs-analysis",
      geometry,
      time: { at: "2017-05-09T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    }).selection).toEqual({ fields: ["wind_10m"] });

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
      },
      selection: pressureSelection,
    })).toThrow("area queries currently support one valid time");
  });

  it("validates diagnostic layer ordering and GEFS range member payload semantics", () => {
    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 500,
        upperPressureHpa: 850,
        diagnostics: ["wind_shear"],
      },
    })).toThrow("lowerPressureHpa must be greater than upperPressureHpa");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "gefs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
      },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 500],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble: {
        includeMembers: true,
      },
    })).toThrow("diagnostic time series return compact member-first summaries");
  });
});
