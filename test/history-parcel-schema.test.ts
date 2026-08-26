import { describe, expect, it } from "vitest";
import {
  historicalParcelQuerySchema,
  historicalParcelTimeSeriesQuerySchema,
} from "../src/schema/history-parcel.js";

const point = { latitude: 50.08, longitude: 14.43 };

describe("historical parcel schemas", () => {
  it("requires two distinct pressure levels for a single parcel", () => {
    const result = historicalParcelQuerySchema.safeParse({
      ...point,
      analysisTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa: [850, 850],
      parcel: "surface_2m",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("two distinct pressure levels"))).toBe(true);
    }
  });

  it("rejects a historical parcel time series whose end precedes its start", () => {
    const result = historicalParcelTimeSeriesQuerySchema.safeParse({
      ...point,
      startTime: "2017-05-10T12:00:00Z",
      endTime: "2017-05-09T12:00:00Z",
      pressureLevelsHpa: [850, 700],
      parcel: "surface_2m",
      cycleHoursUtc: [12],
      maxSteps: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "endTime")).toBe(true);
    }
  });

  it("rejects duplicate parcel time-series cycle hours", () => {
    const result = historicalParcelTimeSeriesQuerySchema.safeParse({
      ...point,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-10T23:59:59Z",
      pressureLevelsHpa: [850, 700],
      parcel: "surface_2m",
      cycleHoursUtc: [12, 12],
      maxSteps: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must not contain duplicates"))).toBe(true);
    }
  });

  it("requires two distinct pressure levels for a parcel time series", () => {
    const result = historicalParcelTimeSeriesQuerySchema.safeParse({
      ...point,
      startTime: "2017-05-09T00:00:00Z",
      endTime: "2017-05-10T23:59:59Z",
      pressureLevelsHpa: [850, 850],
      parcel: "surface_2m",
      cycleHoursUtc: [12],
      maxSteps: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("two distinct pressure levels"))).toBe(true);
    }
  });
});
