import { describe, expect, it, vi } from "vitest";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";

const POINTS = [
  { latitude: 45, longitude: 10 },
  { latitude: 46, longitude: 11 },
  { latitude: 47, longitude: 12 },
];

describe("unified atmospheric query budget", () => {
  it("rejects before dataset adapter acquisition starts", async () => {
    const query = vi.fn(async () => ({ unreachable: true }));
    const service = new UnifiedAtmosphereQueryService({
      adapters: { gfs: { query } },
    });

    await expect(service.query({
      dataset: "gfs",
      geometry: { type: "points", points: POINTS },
      time: {
        from: "2026-09-10T00:00:00Z",
        to: "2026-09-10T02:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      limits: { maxPointSteps: 8 },
    })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
      details: {
        limitingDimension: "point_steps",
        requestedPointSteps: 9,
        maxPointSteps: 8,
      },
    });

    expect(query).not.toHaveBeenCalled();
  });
});
