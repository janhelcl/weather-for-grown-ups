import { describe, expect, it, vi } from "vitest";
import { GefsMemberBundleService } from "../src/core/gefs-member-bundle.js";
import type { DecodedValue } from "../src/types/decoded.js";

const run = new Date("2026-08-24T00:00:00Z");
const validTime = new Date("2026-08-24T03:00:00Z");
const gridPoint = { latitude: 50, longitude: 14.5 };

function decodedFor(member: "c00" | "p01"): DecodedValue[] {
  const warmer = member === "p01" ? 2 : 0;
  const wetter = member === "p01" ? 10 : 0;
  return [
    { code: "TMP", pressureHpa: 850, value: 283.15 + warmer, gridPoint },
    { code: "RH", pressureHpa: 850, value: 50 + wetter, gridPoint },
    { code: "TMP", heightAboveGroundM: 2, value: 288.15 + warmer, gridPoint },
    { code: "UGRD", heightAboveGroundM: 10, value: member === "c00" ? 1 : -1, gridPoint },
    { code: "VGRD", heightAboveGroundM: 10, value: -1, gridPoint },
    {
      code: "APCP",
      surface: true,
      accumulation: { startForecastHour: 0, endForecastHour: 3 },
      value: member === "c00" ? 2 : 4,
      gridPoint,
    },
  ];
}

describe("GEFS member bundle", () => {
  it("fetches and decodes one mixed dependency slice per member", async () => {
    const fetchSelection = vi.fn(async (request: { member: string }) => ({
      path: `/tmp/${request.member}.grib2`,
      cacheHit: request.member === "c00",
    }));
    const extractPoint = vi.fn(async (path: string) => decodedFor(path.includes("p01") ? "p01" : "c00"));
    const service = new GefsMemberBundleService({
      source: { fetchSelection },
      decoder: { extractPoint },
      latestRunProvider: { resolveLatestRun: async () => run },
      concurrency: 2,
    });

    const result = await service.getBundle({
      latitude: 50.08,
      longitude: 14.43,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      selection: {
        variables: ["temperature", "dew_point"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m", "total_precipitation"],
      },
      members: ["c00", "p01"],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(extractPoint).toHaveBeenCalledTimes(2);
    for (const call of fetchSelection.mock.calls) {
      const request = call[0] as {
        variableCodes: string[];
        pressureLevelsHpa: number[];
        fields: { id: string }[];
      };
      expect(new Set(request.variableCodes)).toEqual(new Set(["TMP", "RH"]));
      expect(request.pressureLevelsHpa).toEqual([850]);
      expect(new Set(request.fields.map((field) => field.id))).toEqual(new Set([
        "temperature_2m",
        "u_wind_10m",
        "v_wind_10m",
        "total_precipitation",
      ]));
    }

    expect(result.pressureSummaries.find((summary) => summary.variable === "temperature")?.distribution.mean).toBeCloseTo(11, 10);
    expect(result.pressureSummaries.find((summary) => summary.variable === "dew_point")?.distribution.memberCount).toBe(2);

    const temperature2m = result.fieldSummaries.find((summary) => summary.field === "temperature_2m");
    expect(temperature2m?.outputs[0]).toMatchObject({
      aggregation: "numeric_distribution",
      field: "temperatureC",
      distribution: { mean: 16 },
    });

    const wind = result.fieldSummaries.find((summary) => summary.field === "wind_10m");
    expect(wind?.outputs.map((output) => output.aggregation)).toEqual([
      "numeric_distribution",
      "circular_direction",
    ]);
    const direction = wind?.outputs[1];
    expect(direction?.aggregation).toBe("circular_direction");
    if (!direction || direction.aggregation !== "circular_direction") throw new Error("Expected circular direction summary");
    expect(direction.resultantLength).toBeGreaterThan(0);

    const precipitation = result.fieldSummaries.find((summary) => summary.field === "total_precipitation");
    expect(precipitation?.temporal).toEqual({
      type: "accumulation",
      startForecastHour: 0,
      endForecastHour: 3,
      startTime: run.toISOString(),
      endTime: validTime.toISOString(),
    });
    expect(precipitation?.outputs[0]).toMatchObject({
      aggregation: "numeric_distribution",
      distribution: { mean: 3 },
    });
    expect(result.members).toHaveLength(2);
    expect(result.source.allCacheHit).toBe(false);
  });

  it("rejects incomplete or unsupported mixed selections before member access", async () => {
    const fetchSelection = vi.fn();
    const service = new GefsMemberBundleService({
      source: { fetchSelection },
      decoder: { extractPoint: vi.fn() },
      latestRunProvider: { resolveLatestRun: async () => run },
    });

    await expect(service.getBundle({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      selection: { variables: ["temperature"], fields: [] },
      members: ["c00", "p01"],
    })).rejects.toThrow("pressureLevelsHpa");

    await expect(service.getBundle({
      latitude: 50,
      longitude: 14,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [300],
        fields: [],
      },
      members: ["c00", "p01"],
    })).rejects.toThrow("cannot satisfy temperature at 300 hPa");

    expect(fetchSelection).not.toHaveBeenCalled();
  });
});
