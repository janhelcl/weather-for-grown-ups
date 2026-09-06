import { describe, expect, it, vi } from "vitest";
import { ArchivedGfsForecastQueryService } from "../src/core/archived-gfs-query.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

describe("archived GFS composed provenance", () => {
  it("aggregates the routes that actually served time-series steps", async () => {
    const profile = {
      getArchivedForecastProfile: vi.fn(async (input: any) => {
        const useFallback = input.forecastHour === 3;
        return {
          model: "gfs_grid4_forecast_0p5_archive",
          runTime: input.runTime.toISOString(),
          validTime: new Date(input.runTime.getTime() + input.forecastHour * 3_600_000).toISOString(),
          forecastHour: input.forecastHour,
          requestedPoint: { latitude: input.latitude, longitude: input.longitude },
          gridPoint: { latitude: 50, longitude: 14.5 },
          selection: {
            variables: input.variables,
            pressureLevelsHpa: input.pressureLevelsHpa,
          },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: useFallback
            ? {
                provider: "NOAA NCEI",
                access: "ncei_thredds_ncss",
                dataset: "fallback-f003",
                cacheHit: false,
              }
            : {
                provider: "NOAA AWS Open Data",
                access: "s3_range",
                dataset: "primary-f000",
                cacheHit: false,
              },
        };
      }),
    };

    const service = new ArchivedGfsForecastQueryService({
      profile,
      now: () => new Date("2026-09-06T00:00:00Z"),
    });
    const request = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2024-06-01T00:00:00Z",
        to: "2024-06-01T03:00:00Z",
      },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      forecast: {
        run: "2024-06-01T00:00:00Z",
        grid: "0p50",
      },
      source: "archive",
    });

    const result = await service.query(request) as any;
    expect(result.source).toEqual({
      routes: [
        { provider: "NOAA AWS Open Data", access: "s3_range" },
        { provider: "NOAA NCEI", access: "ncei_thredds_ncss" },
      ],
      composition: "serial_native_forecast_steps",
    });
    expect(result.series).toMatchObject([
      { provider: "NOAA AWS Open Data", access: "s3_range", dataset: "primary-f000" },
      { provider: "NOAA NCEI", access: "ncei_thredds_ncss", dataset: "fallback-f003" },
    ]);
  });
});
