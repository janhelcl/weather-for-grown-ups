import { describe, expect, it } from "vitest";
import {
  ifsPointsQuerySchema,
  ifsPointsTimeSeriesQuerySchema,
  ifsTimeSeriesQuerySchema,
  ifsTransectQuerySchema,
} from "../src/schema/ifs-spatiotemporal.js";

const point = { latitude: 50.08, longitude: 14.43 };
const run = "2026-08-27T12:00:00Z";

describe("IFS spatiotemporal query schemas", () => {
  it("requires pressure variables and levels as a pair across composed queries", () => {
    expect(() => ifsTimeSeriesQuerySchema.parse({
      ...point,
      run,
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      variables: ["temperature"],
    })).toThrow("must be supplied together");

    expect(() => ifsPointsQuerySchema.parse({
      points: [point],
      run,
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [850],
    })).toThrow("must be supplied together");
  });

  it("requires at least one pressure or field selection", () => {
    expect(() => ifsPointsQuerySchema.parse({
      points: [point],
      run,
      validTime: "2026-08-27T18:00:00Z",
    })).toThrow("Request at least one IFS pressure variable or field");
  });

  it("rejects reversed time ranges for point and multi-point series", () => {
    expect(() => ifsTimeSeriesQuerySchema.parse({
      ...point,
      run,
      startTime: "2026-08-27T18:00:00Z",
      endTime: "2026-08-27T12:00:00Z",
      fields: ["wind_10m"],
    })).toThrow("endTime must be at or after startTime");

    expect(() => ifsPointsTimeSeriesQuerySchema.parse({
      points: [point],
      run,
      startTime: "2026-08-27T18:00:00Z",
      endTime: "2026-08-27T12:00:00Z",
      fields: ["wind_10m"],
    })).toThrow("endTime must be at or after startTime");
  });

  it("applies bounded defaults for time and transect composition", () => {
    const series = ifsPointsTimeSeriesQuerySchema.parse({
      points: [point],
      run,
      startTime: "2026-08-27T12:00:00Z",
      endTime: "2026-08-27T18:00:00Z",
      fields: ["wind_10m"],
    });
    expect(series.maxSteps).toBe(85);
    expect(series.maxPointSteps).toBe(1700);

    const transect = ifsTransectQuerySchema.parse({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 50.5, longitude: 15 },
      run,
      validTime: "2026-08-27T18:00:00Z",
      fields: ["wind_10m"],
    });
    expect(transect.samples).toBe(21);
  });

  it("rejects degenerate transects", () => {
    expect(() => ifsTransectQuerySchema.parse({
      start: point,
      end: point,
      run,
      validTime: "2026-08-27T18:00:00Z",
      fields: ["wind_10m"],
    })).toThrow("Transect start and end coordinates must differ");
  });
});
