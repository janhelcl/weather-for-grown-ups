import { describe, expect, it, vi } from "vitest";
import { IfsProfileService } from "../src/core/ifs-profile.js";
import { ifsEnsForecastHour } from "../src/core/ifs-time.js";
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
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
      relativeHumidityPct: 50,
      specificHumidityKgKg: 0.005,
    });
    expect(result.levels[0]?.temperatureC).toBeCloseTo(6.85);
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
      access: "indexed_http_range",
      product: "ifs_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    });
  });

  it("normalizes the remaining first-slice field units in a field-only query", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "ifs-fields", cacheHit: true }));
    const values: DecodedValue[] = [
      { code: "sp", surface: true, value: 101325, gridPoint },
      { code: "2d", heightAboveGroundM: 2, value: 285, gridPoint },
      { code: "100u", heightAboveGroundM: 100, value: 5, gridPoint },
      { code: "100v", heightAboveGroundM: 100, value: 12, gridPoint },
      { code: "tcwv", namedVertical: "entire atmosphere", value: 22, gridPoint },
      { code: "lcc", namedVertical: "low cloud layer", value: 0.1, gridPoint },
      { code: "mcc", namedVertical: "middle cloud layer", value: 0.2, gridPoint },
      { code: "hcc", namedVertical: "high cloud layer", value: 0.3, gridPoint },
    ];
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: { extractPoint: vi.fn(async () => values) },
    });

    const result = await service.getProfile({
      latitude: 50,
      longitude: 14,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      fields: [
        "surface_pressure",
        "dew_point_2m",
        "wind_100m",
        "precipitable_water",
        "low_cloud_cover",
        "middle_cloud_cover",
        "high_cloud_cover",
      ],
    });

    expect(result.levels).toEqual([]);
    expect(result.fields?.find((field) => field.id === "surface_pressure")?.values.pressurePa).toBe(101325);
    expect(result.fields?.find((field) => field.id === "dew_point_2m")?.values.dewPointC).toBeCloseTo(11.85);
    expect(result.fields?.find((field) => field.id === "wind_100m")?.values.windSpeedMs).toBe(13);
    expect(result.fields?.find((field) => field.id === "precipitable_water")?.values.precipitableWaterKgM2).toBe(22);
    expect(result.fields?.find((field) => field.id === "low_cloud_cover")?.values.cloudCoverPct).toBeCloseTo(10);
    expect(result.fields?.find((field) => field.id === "middle_cloud_cover")?.values.cloudCoverPct).toBeCloseTo(20);
    expect(result.fields?.find((field) => field.id === "high_cloud_cover")?.values.cloudCoverPct).toBeCloseTo(30);
    expect(result.source.cacheHit).toBe(true);
  });

  it("normalizes ECMWF vorticity/divergence and derives canonical 2 m humidity", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "ifs-expanded", cacheHit: false }));
    const values: DecodedValue[] = [
      { code: "vo", pressureHpa: 850, value: 1e-5, gridPoint },
      { code: "d", pressureHpa: 850, value: -2e-5, gridPoint },
      { code: "2t", heightAboveGroundM: 2, value: 293.15, gridPoint },
      { code: "2d", heightAboveGroundM: 2, value: 283.15, gridPoint },
      { code: "sp", surface: true, value: 100000, gridPoint },
    ];
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint: vi.fn(async () => values) },
    });

    const result = await service.getProfile({
      latitude: 50,
      longitude: 14,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      variables: ["absolute_vorticity", "divergence"],
      pressureLevelsHpa: [850],
      fields: ["relative_humidity_2m", "specific_humidity_2m"],
    });

    const request = fetchSelection.mock.calls[0]?.[0];
    expect(request.selectors.map((selector: any) => selector.param)).toEqual([
      "vo", "d", "2t", "2d", "sp",
    ]);

    const coriolis = 2 * 7.292115e-5 * Math.sin(50 * Math.PI / 180);
    expect(result.levels[0]?.absoluteVorticityS1).toBeCloseTo(1e-5 + coriolis, 10);
    expect(result.levels[0]?.divergenceS1).toBe(-2e-5);

    const relativeHumidity = result.fields?.find((field) => field.id === "relative_humidity_2m");
    const specificHumidity = result.fields?.find((field) => field.id === "specific_humidity_2m");
    expect(relativeHumidity?.values.relativeHumidityPct).toBeGreaterThan(40);
    expect(relativeHumidity?.values.relativeHumidityPct).toBeLessThan(60);
    expect(specificHumidity?.values.specificHumidityKgKg).toBeGreaterThan(0.005);
    expect(specificHumidity?.values.specificHumidityKgKg).toBeLessThan(0.01);
  });

  it("composes requested-step fields with run-static surface geopotential", async () => {
    const fetchSelection = vi.fn(async ({ forecastHour }: any) => ({
      path: `ifs-f${forecastHour}`,
      cacheHit: forecastHour === 0,
    }));
    const extractPoint = vi.fn(async (path: string): Promise<DecodedValue[]> => {
      if (path === "ifs-f0") {
        return [{ code: "z", surface: true, value: 980.665, gridPoint }];
      }
      return [
        { code: "sp", surface: true, value: 100000, gridPoint },
        { code: "2t", heightAboveGroundM: 2, value: 293.15, gridPoint },
      ];
    });
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint },
    });

    const result = await service.getProfile({
      latitude: 50,
      longitude: 14,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m"],
    });

    expect(fetchSelection).toHaveBeenNthCalledWith(1, expect.objectContaining({
      forecastHour: 6,
      selectors: expect.arrayContaining([
        expect.objectContaining({ param: "sp" }),
        expect.objectContaining({ param: "2t" }),
      ]),
    }));
    expect(fetchSelection).toHaveBeenNthCalledWith(2, expect.objectContaining({
      forecastHour: 0,
      selectors: [expect.objectContaining({ param: "z", sourceForecastHour: 0 })],
    }));
    expect(result.fields?.find((field) => field.id === "surface_geopotential_height")
      ?.values.geopotentialHeightGpm).toBeCloseTo(100, 8);
    expect(result.source.cacheHit).toBe(false);
  });

  it("keeps run-static orography separate from ordinary forecast fields even at f000", async () => {
    const fetchSelection = vi.fn(async ({ selectors }: any) => ({
      path: selectors[0]?.param === "z" ? "ifs-f0-static" : "ifs-f0-forecast",
      cacheHit: false,
    }));
    const extractPoint = vi.fn(async (path: string): Promise<DecodedValue[]> => {
      if (path === "ifs-f0-static") {
        return [{ code: "z", surface: true, value: 980.665, gridPoint }];
      }
      return [{ code: "sp", surface: true, value: 100000, gridPoint }];
    });
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint },
    });

    const result = await service.getProfile({
      latitude: 50,
      longitude: 14,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T12:00:00Z",
      fields: ["surface_pressure", "surface_geopotential_height"],
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(fetchSelection.mock.calls[0]?.[0]).toMatchObject({
      forecastHour: 0,
      selectors: [expect.objectContaining({ param: "sp" })],
    });
    expect(fetchSelection.mock.calls[1]?.[0]).toMatchObject({
      forecastHour: 0,
      selectors: [expect.objectContaining({ param: "z", sourceForecastHour: 0 })],
    });
    expect(result.fields?.find((field) => field.id === "surface_geopotential_height")
      ?.values.geopotentialHeightGpm).toBeCloseTo(100, 8);
  });

  it("samples ENS-native long-range leads without weakening deterministic IFS validation", async () => {
    const fetchSelection = vi.fn(async ({ forecastHour }: any) => ({
      path: `ifs-ens-f${forecastHour}`,
      cacheHit: false,
    }));
    const service = new IfsProfileService({
      source: { fetchSelection },
      decoder: {
        engine: "gribberish",
        extractPoint: vi.fn(async () => [
          { code: "t", pressureHpa: 850, value: 280, gridPoint },
        ]),
      },
    });
    const run = "2026-08-27T12:00:00Z";
    const validTime = "2026-09-09T00:00:00Z"; // f300

    await expect(service.getProfile({
      latitude: 50,
      longitude: 14,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow("does not publish f300");

    const sample = await service.getProfileSample({
      latitude: 50,
      longitude: 14,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    }, {
      forecastHourResolver: ifsEnsForecastHour,
      sourceProduct: "ifs_0p25_enfo_ef",
    });

    expect(sample.forecastHour).toBe(300);
    expect(sample.levels[0]?.temperatureC).toBeCloseTo(6.85);
    expect(sample.source.product).toBe("ifs_0p25_enfo_ef");
    expect(fetchSelection).toHaveBeenLastCalledWith(expect.objectContaining({ forecastHour: 300 }));
  });

  it("rejects selected fields that resolve to different IFS grid cells", async () => {
    const service = new IfsProfileService({
      source: { fetchSelection: vi.fn(async () => ({ path: "ifs-drift", cacheHit: false })) },
      decoder: {
        extractPoint: vi.fn(async () => [
          { code: "2t", heightAboveGroundM: 2, value: 290, gridPoint },
          { code: "2d", heightAboveGroundM: 2, value: 285, gridPoint: { latitude: 50.25, longitude: 14.5 } },
        ]),
      },
    });

    await expect(service.getProfile({
      latitude: 50,
      longitude: 14,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      fields: ["temperature_2m", "dew_point_2m"],
    })).rejects.toThrow("inconsistent grid points");
  });
});
