import { describe, expect, it } from "vitest";
import { profileQuerySchema, timeSeriesQuerySchema } from "../src/schema/query.js";

const point = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
};

describe("non-isobaric query schema", () => {
  it("accepts a fields-only profile without fake pressure levels", () => {
    const result = profileQuerySchema.parse({
      ...point,
      validTime: "2026-08-19T12:00:00Z",
      fields: ["temperature_2m", "wind_10m", "total_precipitation"],
    });
    expect(result.variables).toBeUndefined();
    expect(result.pressureLevelsHpa).toBeUndefined();
    expect(result.fields).toEqual(["temperature_2m", "wind_10m", "total_precipitation"]);
  });

  it("accepts mixed pressure-level and non-isobaric selections", () => {
    expect(profileQuerySchema.safeParse({
      ...point,
      validTime: "2026-08-19T12:00:00Z",
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 700],
      fields: ["surface_cape", "wind_80m"],
    }).success).toBe(true);
  });

  it("rejects a pressure variable selection without pressure levels and vice versa", () => {
    expect(profileQuerySchema.safeParse({ ...point, validTime: "2026-08-19T12:00:00Z", variables: ["temperature"] }).success).toBe(false);
    expect(profileQuerySchema.safeParse({ ...point, validTime: "2026-08-19T12:00:00Z", pressureLevelsHpa: [850] }).success).toBe(false);
  });

  it("rejects an empty atmospheric selection", () => {
    expect(profileQuerySchema.safeParse({ ...point, validTime: "2026-08-19T12:00:00Z" }).success).toBe(false);
  });

  it("rejects unknown non-isobaric field ids", () => {
    expect(profileQuerySchema.safeParse({
      ...point,
      validTime: "2026-08-19T12:00:00Z",
      fields: ["temperature_17m"],
    }).success).toBe(false);
  });

  it("allows fields-only native time series", () => {
    expect(timeSeriesQuerySchema.safeParse({
      ...point,
      startTime: "2026-08-19T07:00:00Z",
      endTime: "2026-08-19T12:00:00Z",
      fields: ["wind_100m", "total_precipitation"],
    }).success).toBe(true);
  });
});
