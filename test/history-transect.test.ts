import { describe, expect, it, vi } from "vitest";
import { AtmosphericTransectService } from "../src/core/atmospheric-transect-service.js";
import { HistoricalTransectService } from "../src/core/history-transect.js";
import type { HistoricalPointsQueryInput, HistoricalPointsResult } from "../src/schema/history-points.js";

const analysisTime = "2017-05-09T12:00:00.000Z";

function resultFor(query: HistoricalPointsQueryInput): HistoricalPointsResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    analysisTime,
    selection: {
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    },
    points: query.points.map((point) => ({
      requestedPoint: point,
      gridPoint: {
        latitude: Math.round(point.latitude * 2) / 2,
        longitude: Math.round(point.longitude * 2) / 2,
      },
      levels: [{ pressureHpa: 850, temperatureC: 5 }],
      dataset: "archive.grb2",
      cacheHit: true,
    })),
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      composition: "serial_point_queries",
    },
    caveat: "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  };
}

describe("HistoricalTransectService", () => {
  it("reuses shared great-circle geometry and delegates all samples to historical points", async () => {
    const getPoints = vi.fn(async (query: HistoricalPointsQueryInput) => resultFor(query));
    const service = new HistoricalTransectService({ pointsGetter: { getPoints } });

    const result = await service.getTransect({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 48, longitude: 16 },
      analysisTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      samples: 5,
    });

    expect(getPoints).toHaveBeenCalledOnce();
    expect(getPoints.mock.calls[0]?.[0].points).toHaveLength(5);
    expect(result.samples).toHaveLength(5);
    expect(result.samples[0]?.fraction).toBe(0);
    expect(result.samples[4]?.fraction).toBe(1);
    expect(result.samples[4]?.distanceKm).toBeCloseTo(result.totalDistanceKm);
    expect(result.source.composition).toBe("great_circle_to_serial_point_queries");
    expect("run" in result).toBe(false);
  });

  it("participates in the shared atmospheric transect dispatcher", async () => {
    const historical = await new HistoricalTransectService({
      pointsGetter: { getPoints: async (query) => resultFor(query) },
    }).getTransect({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 49, longitude: 15 },
      analysisTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      samples: 3,
    });
    const getTransect = vi.fn(async () => historical);
    const service = new AtmosphericTransectService({
      history: { getTransect },
      gfs: { getTransect: vi.fn() } as never,
      gefs: { getTransect: vi.fn() } as never,
    });

    const result = await service.getTransect({
      model: "gfs_grid4_analysis_0p5",
      query: {
        start: historical.startPoint,
        end: historical.endPoint,
        analysisTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        samples: 3,
      },
    });

    expect(result.model).toBe("gfs_grid4_analysis_0p5");
    expect(getTransect).toHaveBeenCalledOnce();
  });
});
