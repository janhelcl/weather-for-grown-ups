import { describe, expect, it } from "vitest";
import {
  gefsReforecastPointsTimeSeriesQuerySchema,
  gefsReforecastTimeSeriesQuerySchema,
} from "../src/schema/gefs-reforecast.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

const base = {
  dataset: "gefs" as const,
  geometry: { type: "point" as const, latitude: 50.08, longitude: 14.43 },
  time: { at: "2017-03-14T12:00:00Z" },
  selection: { fields: ["temperature_2m"] },
  forecast: { kind: "reforecast" as const, run: "2017-03-14T00:00:00Z" },
};

describe("unified GEFS reforecast branch", () => {
  it("keeps reforecasts under dataset=gefs with an explicit forecast population", () => {
    expect(queryAtmosphereSchema.parse(base)).toMatchObject(base);
  });

  it("rejects implicit latest and unfinished geometries", () => {
    expect(() => queryAtmosphereSchema.parse({
      ...base,
      forecast: { kind: "reforecast", run: "latest" },
    })).toThrow("explicit historical 00Z initialization");

    expect(queryAtmosphereSchema.parse({
      ...base,
      geometry: {
        type: "points",
        points: [{ latitude: 50.08, longitude: 14.43 }, { latitude: 49.2, longitude: 16.61 }],
      },
    })).toMatchObject({
      geometry: { type: "points" },
    });

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      geometry: {
        type: "transect",
        start: { latitude: 50.08, longitude: 14.43 },
        end: { latitude: 49.2, longitude: 16.61 },
        samples: 10,
      },
    })).toThrow("point and multi-point geometry");

    expect(queryAtmosphereSchema.parse({
      ...base,
      geometry: {
        type: "points",
        points: [{ latitude: 50.08, longitude: 14.43 }, { latitude: 49.2, longitude: 16.61 }],
      },
      time: { from: "2017-03-14T03:00:00Z", to: "2017-03-14T12:00:00Z" },
    })).toMatchObject({
      geometry: { type: "points" },
      time: { from: "2017-03-14T03:00:00Z", to: "2017-03-14T12:00:00Z" },
    });

    expect(queryAtmosphereSchema.parse({
      ...base,
      time: { from: "2017-03-14T03:00:00Z", to: "2017-03-14T12:00:00Z" },
    })).toMatchObject({
      time: { from: "2017-03-14T03:00:00Z", to: "2017-03-14T12:00:00Z" },
    });

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      time: { from: "2017-03-14T03:00:00Z", to: "2017-03-14T12:00:00Z" },
      ensemble: { members: ["c00", "p01"], includeMembers: true },
    })).toThrow("time ranges return compact member-first summaries");
  });

  it("accepts verified pressure profiles and rejects unsupported pressure semantics", () => {
    expect(queryAtmosphereSchema.parse({
      ...base,
      selection: {
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
    })).toMatchObject({
      selection: {
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
    });

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      selection: {
        variables: ["specific_humidity"],
        pressureLevelsHpa: [50],
      },
    })).toThrow("specific_humidity at 50 hPa");

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
    })).toThrow("either a pressure profile or non-isobaric fields");
  });

  it("rejects fields and members whose retrospective semantics are not implemented", () => {
    expect(() => queryAtmosphereSchema.parse({
      ...base,
      selection: { fields: ["relative_humidity_2m"] },
    })).toThrow("fields not yet supported");

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      ensemble: { members: ["c00", "p30"] },
    })).toThrow("members are c00,p01..p10");
  });

  it("does not allow reforecast semantics to leak to other forecast datasets", () => {
    expect(() => queryAtmosphereSchema.parse({
      ...base,
      dataset: "ifs",
    })).toThrow("only for dataset=gefs");
  });

  it("validates direct reforecast range bounds and duplicate selections", () => {
    const rangeBase = {
      latitude: 50.08,
      longitude: 14.43,
      run: "2017-03-14T00:00:00Z",
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      selection: { kind: "fields" as const, fields: ["temperature_2m" as const] },
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
    };

    expect(() => gefsReforecastTimeSeriesQuerySchema.parse({
      ...rangeBase,
      startTime: "2017-03-14T06:00:00Z",
      endTime: "2017-03-14T03:00:00Z",
    })).toThrow("endTime must be at or after startTime");

    expect(() => gefsReforecastTimeSeriesQuerySchema.parse({
      ...rangeBase,
      members: ["c00", "c00"],
    })).toThrow("members must not contain duplicates");

    expect(() => gefsReforecastTimeSeriesQuerySchema.parse({
      ...rangeBase,
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");

    expect(() => gefsReforecastTimeSeriesQuerySchema.parse({
      ...rangeBase,
      selection: {
        kind: "fields",
        fields: ["temperature_2m", "temperature_2m"],
      },
    })).toThrow("fields must not contain duplicates");

    expect(() => gefsReforecastTimeSeriesQuerySchema.parse({
      ...rangeBase,
      selection: {
        kind: "profile",
        variables: ["temperature", "temperature"],
        pressureLevelsHpa: [850, 850],
      },
    })).toThrow();
  });


  it("validates direct reforecast multi-point range matrix and selection guards", () => {
    const range = {
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run: "2017-03-14T00:00:00Z",
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T06:00:00Z",
      selection: { kind: "fields" as const, fields: ["temperature_2m" as const] },
      members: ["c00" as const, "p01" as const],
      quantiles: [0.5],
      maxPointSteps: 4,
    };
    expect(gefsReforecastPointsTimeSeriesQuerySchema.parse(range)).toMatchObject({
      maxPointSteps: 4,
    });
    expect(() => gefsReforecastPointsTimeSeriesQuerySchema.parse({
      ...range,
      startTime: "2017-03-14T06:00:00Z",
      endTime: "2017-03-14T03:00:00Z",
    })).toThrow("endTime must be at or after startTime");
    expect(() => gefsReforecastPointsTimeSeriesQuerySchema.parse({
      ...range,
      members: ["c00", "c00"],
    })).toThrow("members must not contain duplicates");
  });

});
