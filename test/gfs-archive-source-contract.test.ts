import { describe, expect, it } from "vitest";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

const baseRequest = {
  dataset: "gfs" as const,
  geometry: { type: "point" as const, latitude: 50.08, longitude: 14.43 },
  time: { at: "2020-01-01T12:00:00Z" },
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
  },
  source: "archive" as const,
};

describe("GFS archive source public contract", () => {
  it("requires an explicit forecast run", () => {
    expect(() => queryAtmosphereSchema.parse(baseRequest)).toThrow(
      "source=archive requires an explicit GFS forecast.run",
    );

    expect(() => queryAtmosphereSchema.parse({
      ...baseRequest,
      forecast: { run: "latest" },
    })).toThrow("source=archive requires an explicit GFS forecast.run");

    expect(() => queryAtmosphereSchema.parse({
      ...baseRequest,
      forecast: { run: "latest_complete" },
    })).toThrow("source=archive requires an explicit GFS forecast.run");
  });

  it("accepts an explicit run for archive routing", () => {
    expect(queryAtmosphereSchema.parse({
      ...baseRequest,
      forecast: { run: "2019-12-31T18:00:00Z" },
    })).toMatchObject({
      source: "archive",
      forecast: { run: "2019-12-31T18:00:00Z" },
    });
  });
});
