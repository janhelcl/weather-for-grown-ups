import { describe, expect, it } from "vitest";
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

    expect(() => queryAtmosphereSchema.parse({
      ...base,
      geometry: {
        type: "points",
        points: [{ latitude: 50.08, longitude: 14.43 }, { latitude: 49.2, longitude: 16.61 }],
      },
    })).toThrow("currently covers point geometry");

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
});
