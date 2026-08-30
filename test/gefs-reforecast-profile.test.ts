import { describe, expect, it, vi } from "vitest";
import { GefsReforecastProfileService } from "../src/core/gefs-reforecast-profile.js";

const run = "2017-03-14T00:00:00Z";
const validTime = "2017-03-14T12:00:00Z";

describe("GEFSv12 reforecast pressure profiles", () => {
  it("aggregates members on one coherent 0.5-degree column when levels cross 700 hPa", async () => {
    const source = {
      fetchSelection: vi.fn(async ({ member }: any) => ({
        path: member,
        cacheHit: member === "c00",
      })),
    };
    const decoder = {
      engine: "gribberish" as const,
      extractPoint: vi.fn(async (member: string) => {
        const offset = member === "c00" ? 0 : 1;
        const gridPoint = { latitude: 50, longitude: 14.5 };
        return [
          { code: "TMP", pressureHpa: 850, value: 280 + offset, gridPoint },
          { code: "TMP", pressureHpa: 500, value: 250 + offset, gridPoint },
        ];
      }),
    };
    const service = new GefsReforecastProfileService({
      source: source as any,
      decoder,
      concurrency: 2,
    });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [500, 850],
      members: ["p01", "c00"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(result.selection.members).toEqual(["c00", "p01"]);
    expect(result.selection.pressureLevelsHpa).toEqual([850, 500]);
    expect(result.source).toMatchObject({
      archiveType: "reforecast",
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
      allCacheHit: false,
    });
    expect(result.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(result.summaries).toHaveLength(2);
    expect(result.summaries[0]).toMatchObject({
      variable: "temperature",
      gfsCode: "TMP",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      memberCount: 2,
    });
    expect(result.summaries[0]!.mean).toBeCloseTo(7.35, 8);
    expect(result.members).toHaveLength(2);
    expect(source.fetchSelection).toHaveBeenCalledTimes(2);
    expect(source.fetchSelection.mock.calls[0]![0]).toMatchObject({
      pressureLevelsHpa: [850, 500],
      pressureVariables: [{ id: "temperature", gfsCode: "TMP" }],
    });
    for (const call of decoder.extractPoint.mock.calls) {
      expect(call[1]).toBe(14.5);
      expect(call[2]).toBe(50);
    }
  });

  it("keeps lower-atmosphere-only profiles on the native 0.25-degree grid", async () => {
    const service = new GefsReforecastProfileService({
      source: {
        fetchSelection: async ({ member }: any) => ({
          path: member,
          cacheHit: true,
        }),
      } as any,
      decoder: {
        engine: "gribberish" as const,
        extractPoint: async () => [{
          code: "SPFH",
          pressureHpa: 850,
          value: 0.004,
          gridPoint: { latitude: 50, longitude: 14.5 },
        }],
      },
    });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["specific_humidity"],
      pressureLevelsHpa: [850],
      members: ["c00", "p01"],
      quantiles: [0.5],
    });

    expect(result.source).toMatchObject({
      horizontalGridDegrees: 0.25,
      profileGridPolicy: "native_0p25",
    });
    expect(result.summaries[0]).toMatchObject({
      variable: "specific_humidity",
      outputField: "specificHumidityKgKg",
      mean: 0.004,
    });
  });

  it("distinguishes run-local missing archive levels from global capabilities", async () => {
    const service = new GefsReforecastProfileService({
      source: {
        fetchSelection: async ({ member }: any) => ({
          path: member,
          cacheHit: true,
        }),
      } as any,
      decoder: {
        engine: "gribberish" as const,
        extractPoint: async () => [{
          code: "SPFH",
          pressureHpa: 850,
          value: 0.004,
          gridPoint: { latitude: 50, longitude: 14.5 },
        }],
      },
    });

    await expect(service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["specific_humidity"],
      pressureLevelsHpa: [700],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow(
      /specific_humidity@700mb.*available SPFH levels.*850.*run-local archive availability/i,
    );
  });

  it("rejects pressure levels where native specific humidity is absent", async () => {
    await expect(new GefsReforecastProfileService({
      source: { fetchSelection: vi.fn() } as any,
      decoder: { engine: "gribberish", extractPoint: vi.fn() } as any,
    }).getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["specific_humidity"],
      pressureLevelsHpa: [50],
      members: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("specific_humidity at 50 hPa");
  });
});
