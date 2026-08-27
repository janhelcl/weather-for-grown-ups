import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVED_GFS_FORECAST_MODEL,
  ArchivedGfsForecastQueryService,
  archivedGfsForecastHoursInRange,
  shouldUseArchivedGfsForecast,
} from "../src/core/archived-gfs-query.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

function profileMock() {
  return {
    getArchivedForecastProfile: vi.fn(async (query: any) => ({
      model: ARCHIVED_GFS_FORECAST_MODEL,
      runTime: query.runTime.toISOString(),
      forecastHour: query.forecastHour,
      validTime: new Date(query.runTime.getTime() + query.forecastHour * 3_600_000).toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      levels: [{ pressureHpa: 850, temperatureC: 10 + query.forecastHour / 3 }],
      source: {
        provider: "NOAA NCEI" as const,
        access: "ncei_thredds_ncss" as const,
        dataset: `archive-f${String(query.forecastHour).padStart(3, "0")}`,
        cacheHit: true,
      },
    })),
  };
}

describe("archived GFS unified routing policy", () => {
  it("uses the archive only for explicit runs outside the rolling operational window", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const old = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2017-05-09T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    });
    const recent = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-21T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2026-08-20T12:00:00Z" },
    });
    expect(shouldUseArchivedGfsForecast(old, now)).toBe(true);
    expect(shouldUseArchivedGfsForecast(recent, now)).toBe(false);
  });

  it("does not archive non-GFS or symbolic run selectors", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const analysis = queryAtmosphereSchema.parse({
      dataset: "gfs-analysis",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2017-05-09T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    const latest = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "latest" },
    });
    const latestComplete = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "latest_complete" },
    });

    expect(shouldUseArchivedGfsForecast(analysis, now)).toBe(false);
    expect(shouldUseArchivedGfsForecast(latest, now)).toBe(false);
    expect(shouldUseArchivedGfsForecast(latestComplete, now)).toBe(false);
  });

  it("rejects invalid archived forecast ranges", () => {
    const run = new Date("2017-05-07T12:00:00Z");
    expect(() => archivedGfsForecastHoursInRange(
      run,
      new Date("2017-05-08T00:00:00Z"),
      new Date("2017-05-07T00:00:00Z"),
    )).toThrow("endTime must be at or after startTime");
    expect(() => archivedGfsForecastHoursInRange(
      run,
      new Date("2017-05-16T00:00:00Z"),
      new Date("2017-05-17T00:00:00Z"),
    )).toThrow("No native archived GFS Grid 4 forecast outputs");
  });

  it("enumerates native Grid 4 outputs at 3-hour cadence through +192h", () => {
    const run = new Date("2017-05-07T12:00:00Z");
    expect(archivedGfsForecastHoursInRange(
      run,
      new Date("2017-05-07T15:00:00Z"),
      new Date("2017-05-07T21:00:00Z"),
    )).toEqual([3, 6, 9]);
    expect(archivedGfsForecastHoursInRange(
      run,
      new Date("2017-05-15T12:00:00Z"),
      new Date("2017-05-16T12:00:00Z"),
    )).toEqual([192]);
  });
});

describe("ArchivedGfsForecastQueryService", () => {
  it("returns an archived point forecast with ordinary GFS run/valid-time semantics", async () => {
    const profile = profileMock();
    const service = new ArchivedGfsForecastQueryService({
      profile,
      now: () => new Date("2026-08-27T12:00:00Z"),
    });
    const request = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-05-09T15:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    });

    const result = await service.query(request) as any;
    expect(result).toMatchObject({
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: "2017-05-07T12:00:00.000Z",
      validTime: "2017-05-09T15:00:00.000Z",
      forecastHour: 51,
      gridPoint: { latitude: 50, longitude: 14.5 },
    });
    expect(profile.getArchivedForecastProfile).toHaveBeenCalledWith(expect.objectContaining({
      forecastHour: 51,
    }));
  });

  it("builds range, multi-point and transect products from the same archive point primitive", async () => {
    const profile = profileMock();
    const service = new ArchivedGfsForecastQueryService({
      profile,
      now: () => new Date("2026-08-27T12:00:00Z"),
    });

    const range = await service.query(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-05-07T12:00:00Z",
        to: "2017-05-07T18:00:00Z",
        maxSteps: 3,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    })) as any;
    expect(range.series.map((step: any) => step.forecastHour)).toEqual([0, 3, 6]);

    const points = await service.query(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2017-05-07T18:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    })) as any;
    expect(points.points).toHaveLength(2);

    const transect = await service.query(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "transect",
        start: { latitude: 49.5, longitude: 14 },
        end: { latitude: 50, longitude: 15 },
        samples: 4,
      },
      time: { at: "2017-05-07T18:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    })) as any;
    expect(transect.samples).toHaveLength(4);
    expect(transect.samples[0].fraction).toBe(0);
    expect(transect.samples[3].fraction).toBe(1);
  });

  it("enforces archive-only routing guards and range limits", async () => {
    const service = new ArchivedGfsForecastQueryService({
      profile: profileMock(),
      now: () => new Date("2026-08-27T12:00:00Z"),
    });

    await expect(service.query({
      dataset: "gefs",
    } as any)).rejects.toThrow("only accepts dataset=gfs");

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "latest" },
    }))).rejects.toThrow("requires an explicit forecast.run cycle");

    await expect(service.query(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2017-05-07T12:00:00Z",
        to: "2017-05-07T18:00:00Z",
        maxSteps: 2,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    }))).rejects.toThrow("exceeding maxSteps=2");
  });

  it("builds archived multi-point time-series matrices and enforces point-step limits", async () => {
    const service = new ArchivedGfsForecastQueryService({
      profile: profileMock(),
      now: () => new Date("2026-08-27T12:00:00Z"),
    });
    const base = {
      dataset: "gfs" as const,
      geometry: {
        type: "points" as const,
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: {
        from: "2017-05-07T12:00:00Z",
        to: "2017-05-07T15:00:00Z",
        maxSteps: 2,
      },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
    };

    const result = await service.query(queryAtmosphereSchema.parse({
      ...base,
      limits: { maxPointSteps: 4 },
    })) as any;
    expect(result.series).toHaveLength(2);
    expect(result.series[0].points).toHaveLength(2);

    await expect(service.query(queryAtmosphereSchema.parse({
      ...base,
      limits: { maxPointSteps: 3 },
    }))).rejects.toThrow("exceeding maxPointSteps=3");
  });

  it("rejects operational source overrides for archived runs", async () => {
    const service = new ArchivedGfsForecastQueryService({
      profile: profileMock(),
      now: () => new Date("2026-08-27T12:00:00Z"),
    });
    const request = queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2017-05-07T18:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run: "2017-05-07T12:00:00Z", grid: "0p50" },
      source: "s3",
    });
    await expect(service.query(request)).rejects.toThrow(
      "source override is only available for operational GFS",
    );
  });
});
