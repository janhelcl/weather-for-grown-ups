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
  it("accepts a valid profile query", () => {
    expect(profileQuerySchema.parse(baseQuery)).toEqual(baseQuery);
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

  it.each([1, 1100])("accepts pressure-level boundary %s hPa", (level) => {
    expect(parses({ pressureLevelsHpa: [level] }).success).toBe(true);
  });

  it.each([0, 1101, 850.5])("rejects invalid pressure level %s", (level) => {
    expect(parses({ pressureLevelsHpa: [level] }).success).toBe(false);
  });

  it("requires at least one pressure level", () => {
    expect(parses({ pressureLevelsHpa: [] }).success).toBe(false);
  });

  it("rejects ambiguous run and valid times before orchestration starts", () => {
    expect(parses({ run: "2026-08-19T06:00:00" }).success).toBe(false);
    expect(parses({ validTime: "2026-08-19T12:00:00" }).success).toBe(false);
  });
});
