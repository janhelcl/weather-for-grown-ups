import { describe, expect, it, vi } from "vitest";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";

describe("unified GEFS reforecast routing", () => {
  it("routes forecast.kind=reforecast without changing the public dataset id", async () => {
    const operational = { getBundle: vi.fn(async () => ({ route: "operational" })) };
    const reforecast = {
      getPoint: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        route: "reforecast",
      })),
    };
    const service = new UnifiedAtmosphereQueryService({
      gefsBundle: operational as any,
      gefsReforecast: reforecast as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01", "p02", "p03", "p04"],
        quantiles: [0.1, 0.5, 0.9],
      },
    });

    expect(result.dataset).toBe("gefs");
    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.kind).toBe("ensemble");
    expect(result.role).toBe("forecast");
    expect(result.result).toMatchObject({ route: "reforecast" });
    expect(reforecast.getPoint).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      validTime: "2017-03-14T12:00:00Z",
      fields: ["temperature_2m"],
      members: ["c00", "p01", "p02", "p03", "p04"],
    }));
    expect(operational.getBundle).not.toHaveBeenCalled();
  });
});
