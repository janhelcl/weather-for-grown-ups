import { describe, expect, it } from "vitest";
import { HistoricalForecastSkillService } from "../src/core/history-skill.js";
import { HistoricalForecastVerificationService } from "../src/core/history-verification.js";

describe("historical verification provenance", () => {
  it("keeps forecast and reference routes independent", async () => {
    const analysisGetter = {
      getHistoricalProfile: async () => ({
        model: "gfs_grid4_analysis_0p5",
        analysisTime: "2024-06-01T12:00:00.000Z",
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
        levels: [{ pressureHpa: 850, temperatureC: 11 }],
        source: {
          provider: "NOAA NCEI",
          access: "ncei_thredds_ncss",
          dataset: "analysis-ncss",
          cacheHit: false,
        },
      } as any),
    };
    const forecastGetter = {
      getArchivedForecastProfile: async () => ({
        model: "gfs_grid4_forecast_0p5_archive",
        runTime: "2024-06-01T00:00:00.000Z",
        validTime: "2024-06-01T12:00:00.000Z",
        forecastHour: 12,
        requestedPoint: { latitude: 50.08, longitude: 14.43 },
        gridPoint: { latitude: 50, longitude: 14.5 },
        selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
        levels: [{ pressureHpa: 850, temperatureC: 10 }],
        source: {
          provider: "NOAA AWS Open Data",
          access: "s3_range",
          dataset: "forecast-aws",
          cacheHit: false,
        },
      } as any),
    };

    const service = new HistoricalForecastVerificationService({
      analysisGetter,
      forecastGetter,
      now: () => new Date("2026-09-06T00:00:00Z"),
    });
    const result = await service.verify({
      latitude: 50.08,
      longitude: 14.43,
      validTime: "2024-06-01T12:00:00Z",
      leadHours: 12,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });

    expect(result.source.forecast).toEqual({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      dataset: "forecast-aws",
    });
    expect(result.source.reference).toEqual({
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: "analysis-ncss",
    });
  });
});

describe("historical skill provenance", () => {
  it("aggregates distinct resolved routes instead of reporting the last provider", async () => {
    let calls = 0;
    const verifier = {
      verify: async (input: any) => {
        calls += 1;
        const forecast = calls === 1
          ? { provider: "NOAA NCEI", access: "ncei_thredds_fileserver", dataset: "forecast-old" }
          : { provider: "NOAA AWS Open Data", access: "s3_range", dataset: "forecast-new" };
        return {
          model: "gfs_grid4_archive_verification_0p5",
          validTime: new Date(input.validTime).toISOString(),
          leadHours: input.leadHours,
          forecastRun: new Date(new Date(input.validTime).getTime() - input.leadHours * 3_600_000).toISOString(),
          requestedPoint: { latitude: input.latitude, longitude: input.longitude },
          gridPoint: { latitude: 50, longitude: 14.5 },
          selection: {
            variables: input.variables,
            pressureLevelsHpa: input.pressureLevelsHpa,
          },
          comparison: "analysis_minus_forecast",
          forecast: {
            model: "gfs_grid4_forecast_0p5_archive",
            runTime: "2020-12-31T12:00:00.000Z",
            forecastHour: input.leadHours,
            validTime: new Date(input.validTime).toISOString(),
            levels: [{ pressureHpa: 850, temperatureC: 10 }],
            dataset: forecast.dataset,
            cacheHit: false,
          },
          analysis: {
            model: "gfs_grid4_analysis_0p5",
            analysisTime: new Date(input.validTime).toISOString(),
            levels: [{ pressureHpa: 850, temperatureC: 11 }],
            dataset: "analysis",
            cacheHit: false,
          },
          pressureLevels: [{
            pressureHpa: 850,
            changes: [{
              field: "temperatureC",
              forecast: 10,
              analysis: 11,
              delta: 1,
              deltaKind: "linear",
            }],
          }],
          source: {
            forecast,
            reference: {
              provider: "NOAA AWS Open Data",
              access: "s3_range",
              dataset: "analysis",
            },
            forecastArchiveAvailability: "online availability varies; older forecast data may require NCEI HAS",
          },
          caveat: "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time",
        } as any;
      },
    };

    const service = new HistoricalForecastSkillService({
      verifier,
      now: () => new Date("2026-09-06T00:00:00Z"),
    });
    const result = await service.summarize({
      latitude: 50.08,
      longitude: 14.43,
      startTime: "2021-01-01T00:00:00Z",
      endTime: "2021-01-01T06:00:00Z",
      cycleHoursUtc: [0, 6],
      leadHours: [12],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxValidTimes: 2,
    });

    expect(result.source.forecastRoutes).toEqual([
      { provider: "NOAA NCEI", access: "ncei_thredds_fileserver", dataset: "forecast-old" },
      { provider: "NOAA AWS Open Data", access: "s3_range", dataset: "forecast-new" },
    ]);
    expect(result.source.referenceRoutes).toEqual([
      { provider: "NOAA AWS Open Data", access: "s3_range", dataset: "analysis" },
    ]);
    expect(result.evaluations.every((evaluation) =>
      evaluation.status !== "success" || evaluation.source.forecast.dataset.startsWith("forecast-"))).toBe(true);
  });
});
