import { describe, expect, it, vi } from "vitest";
import { IfsProfileService } from "../src/core/ifs-profile.js";
import type { DecodedValue } from "../src/core/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };

describe("IFS canonical point profile", () => {
  it("normalizes pressure variables, derived physics, surface fields, and source provenance", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "ifs-fixture", cacheHit: false }));
    const values: DecodedValue[] = [
      { code: "t", pressureHpa: 850, value: 280, gridPoint },
      { code: "u", pressureHpa: 850, value: 3, gridPoint },
      { code: "v", pressureHpa: 850, value: 4, gridPoint },
      { code: "r", pressureHpa: 850, value: 50, gridPoint },
      { code: "q", pressureHpa: 850, value: 0.005, gridPoint },
      { code: "2t", heightAboveGroundM: 2, value: 290, gridPoint },
      { code: "10u", heightAboveGroundM: 10, value: 6, gridPoint },
      { code: "10v", heightAboveGroundM: 10, value: 8, gridPoint },
      { code: "tp", surface: true, value: 0.012, gridPoint },
      { code: "tcc", namedVertical: "entire atmosphere", value: 0.6, gridPoint },
    ];
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint: vi.fn(async () => values) },
    });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      variables: ["temperature", "wind", "dew_point", "specific_humidity"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m", "wind_10m", "total_precipitation", "total_atmosphere_cloud_cover"],
    });

    const request = fetchSelection.mock.calls[0]?.[0];
    expect(request.selectors.map((selector: any) => selector.param)).toEqual([
      "t", "u", "v", "r", "q", "2t", "10u", "10v", "tp", "tcc",
    ]);
    expect(result.model).toBe("ifs_0p25");
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      temperatureC: 6.85,
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
      relativeHumidityPct: 50,
      specificHumidityKgKg: 0.005,
    });
    expect(result.levels[0]?.dewPointC).toBeTypeOf("number");
    expect(result.fields?.find((field) => field.id === "temperature_2m")?.values.temperatureC)
      .toBeCloseTo(16.85);
    expect(result.fields?.find((field) => field.id === "wind_10m")?.values.windSpeedMs).toBe(10);
    expect(result.fields?.find((field) => field.id === "total_precipitation")).toMatchObject({
      temporal: {
        type: "accumulation",
        startForecastHour: 0,
        endForecastHour: 6,
      },
      values: { totalPrecipitationMm: 12 },
    });
    expect(result.fields?.find((field) => field.id === "total_atmosphere_cloud_cover")?.values.cloudCoverPct)
      .toBeCloseTo(60);
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      access: "s3_range",
      product: "ifs_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    });
  });
});
