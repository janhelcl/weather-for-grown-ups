import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiagnostic,
  buildUnifiedQuery,
} from "../src/cli/unified-atmosphere-command.js";
import {
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

describe("unified CLI request builders", () => {
  it("builds a deterministic point forecast with explicit pressure selection", () => {
    const request = buildUnifiedQuery({
      dataset: "gfs",
      lat: 50.08,
      lon: 14.43,
      at: "2026-08-28T12:00:00Z",
      vars: "temperature,wind",
      levels: "850,500",
      run: "latest",
      source: "s3",
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850, 500],
      },
      forecast: { run: "latest" },
      source: "s3",
    });
  });


  it("builds an explicit GEFSv12 reforecast field query without changing the dataset vocabulary", () => {
    const request = buildUnifiedQuery({
      dataset: "gefs",
      lat: 50.08,
      lon: 14.43,
      at: "2017-03-14T12:00:00Z",
      fields: "temperature_2m,wind_10m",
      run: "2017-03-14T00:00:00Z",
      forecastKind: "reforecast",
      members: "c00,p01,p02,p03,p04",
      quantiles: "0.1,0.5,0.9",
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: { fields: ["temperature_2m", "wind_10m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01", "p02", "p03", "p04"],
        quantiles: [0.1, 0.5, 0.9],
      },
    });
  });

  it("builds an ECMWF IFS point query without a GFS grid or source override", () => {
    const request = buildUnifiedQuery({
      dataset: "ifs",
      lat: 50.08,
      lon: 14.43,
      at: "2026-08-28T12:00:00Z",
      vars: "temperature,wind",
      levels: "850,500",
      fields: "temperature_2m,wind_10m",
      run: "latest",
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "ifs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850, 500],
        fields: ["temperature_2m", "wind_10m"],
      },
      forecast: { run: "latest" },
    });
    expect(request).not.toHaveProperty("source");
  });

  it("uses IFS ENS member semantics behind the shared --members flag", () => {
    const request = buildUnifiedQuery({
      dataset: "ifs-ens",
      lat: 50.08,
      lon: 14.43,
      at: "2026-08-28T12:00:00Z",
      vars: "temperature",
      levels: "850",
      members: "p31,p50",
      quantiles: "0.1,0.5,0.9",
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "ifs-ens",
      ensemble: {
        members: ["p31", "p50"],
        quantiles: [0.1, 0.5, 0.9],
      },
    });
  });

  it("builds historical multi-point field ranges without forecast metadata", () => {
    const request = buildUnifiedQuery({
      dataset: "gfs-analysis",
      point: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.20, longitude: 16.61 },
      ],
      from: "2017-05-09T00:00:00Z",
      to: "2017-05-09T18:00:00Z",
      cycles: "0,12",
      maxSteps: 2,
      fields: "wind_10m,temperature_2m",
      maxPointSteps: 8,
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "gfs-analysis",
      geometry: { type: "points" },
      time: {
        from: "2017-05-09T00:00:00Z",
        to: "2017-05-09T18:00:00Z",
        hoursUtc: [0, 12],
        maxSteps: 2,
      },
      selection: { fields: ["wind_10m", "temperature_2m"] },
      limits: { maxPointSteps: 8 },
    });
    expect(request).not.toHaveProperty("forecast");
  });

  it("builds an ensemble transect with member controls", () => {
    const request = buildUnifiedQuery({
      dataset: "gefs",
      start: "49.5,14.0",
      end: "50.0,15.0",
      samples: 5,
      at: "2026-08-28T12:00:00Z",
      fields: "wind_10m",
      run: "latest",
      members: "c00,p01,p02",
      quantiles: "0.1,0.5,0.9",
      includeMembers: true,
      maxMemberSamples: 100,
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      dataset: "gefs",
      geometry: {
        type: "transect",
        start: { latitude: 49.5, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        samples: 5,
      },
      ensemble: {
        members: ["c00", "p01", "p02"],
        quantiles: [0.1, 0.5, 0.9],
        includeMembers: true,
        maxMemberSamples: 100,
      },
    });
  });

  it("builds an ensemble area query with aggregation and guardrails", () => {
    const request = buildUnifiedQuery({
      dataset: "gefs",
      west: 14,
      east: 14.5,
      south: 49.75,
      north: 50.25,
      at: "2026-08-28T12:00:00Z",
      vars: "temperature",
      levels: "850",
      quantiles: "0.1,0.9",
      percentiles: "10,50,90",
      gte: 0,
      lte: 20,
      extrema: true,
      maxGridPoints: 1000,
      maxMemberGridPoints: 30000,
    });

    expect(queryAtmosphereSchema.parse(request)).toMatchObject({
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 14.5,
        southLatitude: 49.75,
        northLatitude: 50.25,
      },
      aggregate: {
        percentiles: [10, 50, 90],
        thresholds: [
          { operator: "gte", value: 0 },
          { operator: "lte", value: 20 },
        ],
        includeExtremaLocations: true,
      },
      limits: {
        maxGridPoints: 1000,
        maxMemberGridPoints: 30000,
      },
    });
  });

  it("uses the cross-dataset pressure defaults when no selection is supplied", () => {
    const request = buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
    });

    expect(request.selection.variables).toEqual([
      "temperature",
      "relative_humidity",
      "u_wind",
      "v_wind",
      "geopotential_height",
    ]);
    expect(request.selection.pressureLevelsHpa).toEqual([1000, 925, 850, 700, 500]);
    expect(request).not.toHaveProperty("ensemble");
    expect(request).not.toHaveProperty("aggregate");
    expect(request).not.toHaveProperty("limits");
  });

  it("validates CLI geometry and time forms before service dispatch", () => {
    expect(() => buildUnifiedQuery({
      dataset: "bogus",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
    })).toThrow("Expected --dataset");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      at: "2026-08-28T12:00:00Z",
    })).toThrow("Choose exactly one geometry");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      at: "2026-08-28T12:00:00Z",
    })).toThrow("Point geometry requires both");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      start: "49,14",
      at: "2026-08-28T12:00:00Z",
    })).toThrow("Transect geometry requires both");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      west: 14,
      east: 15,
      south: 49,
      at: "2026-08-28T12:00:00Z",
    })).toThrow("Area geometry requires");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      lon: 14,
    })).toThrow("Choose exactly one time form");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
      from: "2026-08-28T00:00:00Z",
      to: "2026-08-28T12:00:00Z",
    })).toThrow("Choose exactly one time form");

    expect(() => buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      from: "2026-08-28T00:00:00Z",
    })).toThrow("Time range requires both");
  });

  it("builds all three diagnostic families", () => {
    const layer = buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50.08,
      lon: 14.43,
      at: "2026-08-28T12:00:00Z",
      kind: "layer",
      lower: 850,
      upper: 500,
      diagnostics: "wind_shear,temperature_lapse_rate",
      run: "latest",
      source: "s3",
    });
    expect(diagnoseAtmosphereSchema.parse(layer).diagnostic).toMatchObject({
      kind: "layer",
      diagnostics: ["wind_shear", "temperature_lapse_rate"],
    });

    const profile = buildUnifiedDiagnostic({
      dataset: "gefs",
      lat: 50.08,
      lon: 14.43,
      from: "2026-08-28T00:00:00Z",
      to: "2026-08-28T12:00:00Z",
      maxSteps: 5,
      kind: "profile",
      levels: "1000,850,700,500",
      diagnostics: "freezing_level_crossings",
      members: "c00,p01",
      quantiles: "0.1,0.9",
    });
    expect(diagnoseAtmosphereSchema.parse(profile)).toMatchObject({
      dataset: "gefs",
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850, 700, 500],
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.1, 0.9],
      },
    });

    const parcel = buildUnifiedDiagnostic({
      dataset: "gfs-analysis",
      lat: 50.08,
      lon: 14.43,
      at: "2017-05-09T12:00:00Z",
      kind: "parcel",
      levels: "1000,925,850,700,500,300",
      parcel: "surface_2m",
    });
    expect(diagnoseAtmosphereSchema.parse(parcel)).toMatchObject({
      dataset: "gfs-analysis",
      diagnostic: { kind: "parcel", parcel: "surface_2m" },
    });
    expect(parcel).not.toHaveProperty("forecast");
  });

  it("fails early for incomplete or unknown diagnostic selections", () => {
    expect(() => buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
      kind: "layer",
      lower: 850,
      upper: 500,
    })).toThrow("Layer diagnostics require");

    expect(() => buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
      kind: "profile",
      levels: "850,500",
    })).toThrow("Profile diagnostics require");

    expect(() => buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
      kind: "parcel",
      levels: "850,500",
    })).toThrow("Parcel diagnostics require");

    expect(() => buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-28T12:00:00Z",
      kind: "mystery",
    })).toThrow("Expected --kind");
  });
});
