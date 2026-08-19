import { describe, expect, it } from "vitest";
import { isoDateTimeSchema, profileQuerySchema } from "../src/schema/query.js";

const baseQuery = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z",
  variables: ["temperature", "wind"],
  pressureLevelsHpa: [1000, 850, 700],
};

const parses = (overrides: Record<string, unknown>) => profileQuerySchema.safeParse({ ...baseQuery, ...overrides });

describe("isoDateTimeSchema", () => {
  it.each([
    "2026-08-19T06:00:00Z",
    "2026-08-19T08:00:00+02:00",
    "2026-08-19T04:00:00-02:00",
  ])("accepts timezone-aware ISO date-time %s", (value) => {
    expect(isoDateTimeSchema.safeParse(value).success).toBe(true);
  });

  it.each(["not-a-date", "2026-08-19", "2026-08-19T06:00:00"])(
    "rejects ambiguous or invalid date-time %s",
    (value) => {
      expect(isoDateTimeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("profileQuerySchema", () => {
  it("accepts a valid profile query and defaults the source to NOMADS", () => {
    expect(profileQuerySchema.parse(baseQuery)).toEqual({ ...baseQuery, source: "nomads" });
  });

  it.each(["nomads", "s3"])("accepts source %s", (source) => {
    expect(parses({ source }).success).toBe(true);
  });

  it("rejects unknown source selectors", () => {
    expect(parses({ source: "ftp" }).success).toBe(false);
  });

  it.each([-90, 90])("accepts latitude boundary %s", (latitude) => {
    expect(parses({ latitude }).success).toBe(true);
  });

  it.each([-90.0001, 90.0001])("rejects latitude outside the globe: %s", (latitude) => {
    expect(parses({ latitude }).success).toBe(false);
  });

  it.each([-180, 180])("accepts longitude boundary %s", (longitude) => {
    expect(parses({ longitude }).success).toBe(true);
  });

  it.each([-180.0001, 180.0001])("rejects longitude outside the globe: %s", (longitude) => {
    expect(parses({ longitude }).success).toBe(false);
  });

  it("requires at least one known variable", () => {
    expect(parses({ variables: [] }).success).toBe(false);
    expect(parses({ variables: ["made_up_weather"] }).success).toBe(false);
  });

  it.each([1000, 925, 1, 0.7, 0.01])("accepts published pressure level %s hPa", (level) => {
    expect(parses({ pressureLevelsHpa: [level] }).success).toBe(true);
  });

  it.each([1100, 842, 850.5, 0, -1, 0.05])("rejects unpublished pressure level %s", (level) => {
    expect(parses({ pressureLevelsHpa: [level] }).success).toBe(false);
  });

  it("requires at least one pressure level", () => {
    expect(parses({ pressureLevelsHpa: [] }).success).toBe(false);
  });

  it("accepts every newly supported pressure-level variable", () => {
    const variables = [
      "geopotential_height", "specific_humidity", "vertical_velocity",
      "geometric_vertical_velocity", "absolute_vorticity", "total_cloud_cover",
      "cloud_water_mixing_ratio", "ozone_mixing_ratio",
    ];
    expect(parses({ variables }).success).toBe(true);
  });

  it("rejects ambiguous run and valid times before orchestration starts", () => {
    expect(parses({ run: "2026-08-19T06:00:00" }).success).toBe(false);
    expect(parses({ validTime: "2026-08-19T12:00:00" }).success).toBe(false);
  });
});
