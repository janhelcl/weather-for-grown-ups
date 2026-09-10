import { describe, expect, it } from "vitest";
import { InvalidRequestError } from "../src/failure.js";
import {
  assertAtmosphericQueryWithinBudget,
} from "../src/core/atmospheric-query-budget.js";
import { normalizeQueryAtmosphereInput } from "../src/schema/unified-query-input.js";

function gfsRangeRequest(overrides: Record<string, unknown> = {}) {
  return normalizeQueryAtmosphereInput({
    dataset: "gfs",
    geometry: {
      type: "points",
      points: [
        { latitude: 45, longitude: 10 },
        { latitude: 46, longitude: 11 },
        { latitude: 47, longitude: 12 },
      ],
    },
    time: {
      from: "2026-09-10T00:00:00Z",
      to: "2026-09-10T02:00:00Z",
    },
    selection: { fields: ["temperature_2m"] },
    ...overrides,
  });
}

describe("atmospheric query point-step budget", () => {
  it("rejects excessive fan-out with structured repair details", () => {
    const request = gfsRangeRequest({ limits: { maxPointSteps: 8 } });

    try {
      assertAtmosphericQueryWithinBudget(request);
      throw new Error("Expected atmospheric query budget to reject the request");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError);
      const failure = error as InvalidRequestError;
      expect(failure.code).toBe("INVALID_REQUEST");
      expect(failure.retryable).toBe(false);
      expect(failure.details).toMatchObject({
        limitingDimension: "point_steps",
        requestedPointSteps: 9,
        maxPointSteps: 8,
        spatialSamples: 3,
        timeSteps: 3,
      });
      expect(failure.message).toContain("3 spatial samples × 3 time steps");
    }
  });

  it("honors time.maxSteps when bounding range fan-out", () => {
    const request = gfsRangeRequest({
      time: {
        from: "2026-09-10T00:00:00Z",
        to: "2026-09-11T00:00:00Z",
        maxSteps: 2,
      },
      limits: { maxPointSteps: 6 },
    });

    expect(() => assertAtmosphericQueryWithinBudget(request)).not.toThrow();
  });

  it("uses the selected GFS grid cadence", () => {
    const request = gfsRangeRequest({
      forecast: { run: "latest", grid: "0p50" },
      time: {
        from: "2026-09-10T00:00:00Z",
        to: "2026-09-10T06:00:00Z",
      },
      limits: { maxPointSteps: 8 },
    });

    expect(() => assertAtmosphericQueryWithinBudget(request)).toThrowError(
      /9 > 8 \(3 spatial samples × 3 time steps\)/,
    );
  });

  it("counts default transect samples before retrieval", () => {
    const request = normalizeQueryAtmosphereInput({
      dataset: "gfs",
      geometry: {
        type: "transect",
        start: { latitude: 45, longitude: 10 },
        end: { latitude: 46, longitude: 11 },
      },
      time: { at: "2026-09-10T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      limits: { maxPointSteps: 20 },
    });

    expect(() => assertAtmosphericQueryWithinBudget(request)).toThrowError(/21 > 20/);
  });
});
