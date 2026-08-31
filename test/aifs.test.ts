import { describe, expect, it, vi } from "vitest";
import { AifsForecastService } from "../src/core/aifs.js";
import {
  AIFS_MAX_FORECAST_HOUR,
  aifsForecastHour,
  aifsForecastHoursInRange,
  parseAifsRun,
} from "../src/core/aifs-time.js";
import {
  buildAifsOpenDataForecastIndexUrl,
  buildAifsOpenDataForecastUrl,
} from "../src/sources/aifs-open-data.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import type { DecodedValue } from "../src/core/types.js";

const run = new Date("2026-08-31T00:00:00Z");
const gridPoint = { latitude: 50, longitude: 14.5 };

describe("ECMWF AIFS source semantics", () => {
  it("builds AIFS Single 0.25 degree operational Open Data paths", () => {
    expect(buildAifsOpenDataForecastUrl(run, 6)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-single/0p25/oper/20260831000000-6h-oper-fc.grib2",
    );
    expect(buildAifsOpenDataForecastIndexUrl(run, 360)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260831/00z/aifs-single/0p25/oper/20260831000000-360h-oper-fc.index",
    );
  });

  it("preserves four daily cycles and native 6-hour output through f360", () => {
    expect(AIFS_MAX_FORECAST_HOUR).toBe(360);
    expect(parseAifsRun("2026-08-31T18:00:00Z").toISOString())
      .toBe("2026-08-31T18:00:00.000Z");
    expect(() => parseAifsRun("2026-08-31T09:00:00Z")).toThrow("00/06/12/18");
    expect(aifsForecastHour(run, new Date("2026-08-31T12:00:00Z"))).toBe(12);
    expect(() => aifsForecastHour(run, new Date("2026-08-31T03:00:00Z")))
      .toThrow("native cadence is 6-hourly");
    expect(aifsForecastHoursInRange(
      run,
      new Date("2026-08-31T03:00:00Z"),
      new Date("2026-08-31T18:00:00Z"),
    )).toEqual([6, 12, 18]);
  });
});

describe("AIFS unified capability", () => {
  it("rejects pressure inventory that AIFS Single does not publish", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T12:00:00Z" },
      selection: {
        variables: ["relative_humidity"],
        pressureLevelsHpa: [850],
      },
    })).toThrow("AIFS pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [825],
      },
    })).toThrow("AIFS pressure levels not supported");
  });

  it("normalizes AIFS pressure and surface state while preserving provenance", async () => {
    const fetchSelection = vi.fn(async () => ({ path: "aifs-fixture", cacheHit: false }));
    const values: DecodedValue[] = [
      { code: "t", pressureHpa: 850, value: 280, gridPoint },
      { code: "u", pressureHpa: 850, value: 3, gridPoint },
      { code: "v", pressureHpa: 850, value: 4, gridPoint },
      { code: "z", pressureHpa: 850, value: 14_709.975, gridPoint },
      { code: "q", pressureHpa: 850, value: 0.005, gridPoint },
      { code: "2t", heightAboveGroundM: 2, value: 293.15, gridPoint },
      { code: "10u", heightAboveGroundM: 10, value: 6, gridPoint },
      { code: "10v", heightAboveGroundM: 10, value: 8, gridPoint },
      { code: "tp", surface: true, value: 0.012, gridPoint },
      { code: "2d", heightAboveGroundM: 2, value: 283.15, gridPoint },
    ];
    const service = new AifsForecastService({
      source: { fetchSelection },
      decoder: { engine: "gribberish", extractPoint: vi.fn(async () => values) },
    });

    const result: any = await service.query(queryAtmosphereSchema.parse({
      dataset: "aifs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-08-31T06:00:00Z" },
      forecast: { run: "2026-08-31T00:00:00Z" },
      selection: {
        variables: ["temperature", "wind", "geopotential_height", "specific_humidity"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m", "wind_10m", "total_precipitation", "relative_humidity_2m"],
      },
    }));

    expect(fetchSelection.mock.calls[0]?.[0].selectors.map((selector: any) => selector.param))
      .toEqual(["t", "u", "v", "z", "q", "2t", "10u", "10v", "tp", "2d"]);
    expect(result.model).toBe("aifs_0p25");
    expect(result.forecastHour).toBe(6);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      uWindMs: 3,
      vWindMs: 4,
      windSpeedMs: 5,
      geopotentialHeightGpm: 1500,
      specificHumidityKgKg: 0.005,
    });
    expect(result.levels[0].temperatureC).toBeCloseTo(6.85);
    expect(result.fields.find((field: any) => field.id === "temperature_2m")
      .values.temperatureC).toBeCloseTo(20);
    expect(result.fields.find((field: any) => field.id === "wind_10m")
      .values.windSpeedMs).toBe(10);
    expect(result.fields.find((field: any) => field.id === "total_precipitation"))
      .toMatchObject({
        temporal: { type: "accumulation", startForecastHour: 0, endForecastHour: 6 },
        values: { totalPrecipitationMm: 12 },
      });
    expect(result.fields.find((field: any) => field.id === "relative_humidity_2m")
      .values.relativeHumidityPct).toBeGreaterThan(40);
    expect(result.source).toMatchObject({
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "aifs_single_0p25_oper_fc",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    });
  });
});
