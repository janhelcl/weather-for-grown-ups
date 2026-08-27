import { describe, expect, it, vi } from "vitest";
import { AtmosphericProfileService } from "../src/core/atmospheric-profile-service.js";
import { AtmosphericTimeSeriesService } from "../src/core/atmospheric-timeseries-service.js";
import { gefsEnsembleProfileResultSchema } from "../src/schema/gefs-ensemble-profile.js";
import { gefsEnsembleTimeSeriesResultSchema } from "../src/schema/gefs-ensemble-timeseries.js";
import { profileResultSchema, timeSeriesResultSchema } from "../src/schema/result.js";

const run = "2026-08-23T12:00:00Z";
const validTime = "2026-08-23T18:00:00Z";
const point = { latitude: 50.08, longitude: 14.43 };
const gridPoint = { latitude: 50, longitude: 14.5 };

const gfsProfile = profileResultSchema.parse({
  model: "gfs_0p25",
  run,
  validTime,
  forecastHour: 6,
  requestedPoint: point,
  gridPoint,
  levels: [{ pressureHpa: 850, temperatureC: 7 }],
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", cacheHit: true },
});

const gfs50Profile = profileResultSchema.parse({ ...gfsProfile, model: "gfs_0p50" });

const gefsProfile = gefsEnsembleProfileResultSchema.parse({
  model: "gefs_0p50",
  run,
  validTime,
  forecastHour: 6,
  requestedPoint: point,
  gridPoint,
  selection: {
    variables: ["temperature"],
    pressureLevelsHpa: [850],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  summaries: [{
    variable: "temperature",
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    memberCount: 2,
    mean: 7,
    populationStdDev: 1,
    min: 6,
    max: 8,
    quantiles: [{ quantile: 0.5, value: 7 }],
  }],
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", product: "pgrb2a_0p50", allCacheHit: true },
});

const gfsTimeSeries = timeSeriesResultSchema.parse({
  model: "gfs_0p25",
  run,
  requestedStartTime: validTime,
  requestedEndTime: validTime,
  requestedPoint: point,
  gridPoint,
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2" },
  series: [{ validTime, forecastHour: 6, levels: [{ pressureHpa: 850, temperatureC: 7 }], cacheHit: true }],
});

const gfs50TimeSeries = timeSeriesResultSchema.parse({ ...gfsTimeSeries, model: "gfs_0p50" });

const gefsTimeSeries = gefsEnsembleTimeSeriesResultSchema.parse({
  model: "gefs_0p50",
  run,
  startTime: validTime,
  endTime: validTime,
  stepHours: 3,
  requestedPoint: point,
  gridPoint,
  selection: {
    variable: "temperature",
    gfsCode: "TMP",
    pressureLevelHpa: 850,
    outputField: "temperatureC",
    unit: "degC",
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  includeMembers: false,
  series: [{
    validTime,
    forecastHour: 6,
    summary: {
      memberCount: 2,
      mean: 7,
      populationStdDev: 1,
      min: 6,
      max: 8,
      quantiles: [{ quantile: 0.5, value: 7 }],
    },
  }],
  source: { provider: "NOAA AWS Open Data", access: "s3_range", decoder: "wgrib2", product: "pgrb2a_0p50", allCacheHit: true },
});

describe("unified atmospheric dispatch", () => {
  it("routes profile requests by explicit model without flattening result semantics", async () => {
    const getGfs = vi.fn(async () => gfsProfile);
    const getGefs = vi.fn(async () => gefsProfile);
    const service = new AtmosphericProfileService({
      gfs: { getProfile: getGfs },
      gefs: { getProfile: getGefs },
    });

    const deterministic = await service.getProfile({
      model: "gfs_0p25",
      query: { latitude: point.latitude, longitude: point.longitude, run, validTime, variables: ["temperature"], pressureLevelsHpa: [850], source: "s3" },
    });
    const ensemble = await service.getProfile({
      model: "gefs_0p50",
      query: { latitude: point.latitude, longitude: point.longitude, run, validTime, variables: ["temperature"], pressureLevelsHpa: [850], members: ["c00", "p01"], quantiles: [0.5] },
    });

    expect(deterministic.model).toBe("gfs_0p25");
    expect(ensemble.model).toBe("gefs_0p50");
    expect(getGfs).toHaveBeenCalledTimes(1);
    expect(getGefs).toHaveBeenCalledTimes(1);
  });

  it("makes model=gfs_0p50 authoritative for deterministic profile grid selection", async () => {
    const getGfs = vi.fn(async (query: any) => query.grid === "0p50" ? gfs50Profile : gfsProfile);
    const service = new AtmosphericProfileService({
      gfs: { getProfile: getGfs },
      gefs: { getProfile: async () => gefsProfile },
    });

    const result = await service.getProfile({
      model: "gfs_0p50",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        run,
        validTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        source: "s3",
      },
    });
    expect(result.model).toBe("gfs_0p50");
    expect(getGfs).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });

  it("routes time-series requests through the same operation boundary", async () => {
    const getGfs = vi.fn(async () => gfsTimeSeries);
    const getGefs = vi.fn(async () => gefsTimeSeries);
    const service = new AtmosphericTimeSeriesService({
      gfs: { getTimeSeries: getGfs },
      gefs: { getTimeSeries: getGefs },
    });

    expect((await service.getTimeSeries({
      model: "gfs_0p25",
      query: { latitude: point.latitude, longitude: point.longitude, run, startTime: validTime, endTime: validTime, variables: ["temperature"], pressureLevelsHpa: [850], source: "s3" },
    })).model).toBe("gfs_0p25");
    expect((await service.getTimeSeries({
      model: "gefs_0p50",
      query: { latitude: point.latitude, longitude: point.longitude, run, startTime: validTime, endTime: validTime, variable: "temperature", pressureLevelHpa: 850, members: ["c00", "p01"], quantiles: [0.5] },
    })).model).toBe("gefs_0p50");
  });

  it("makes model=gfs_0p50 authoritative for deterministic time-series grid selection", async () => {
    const getGfs = vi.fn(async (query: any) => query.grid === "0p50" ? gfs50TimeSeries : gfsTimeSeries);
    const service = new AtmosphericTimeSeriesService({
      gfs: { getTimeSeries: getGfs },
      gefs: { getTimeSeries: async () => gefsTimeSeries },
    });

    const result = await service.getTimeSeries({
      model: "gfs_0p50",
      query: {
        latitude: point.latitude,
        longitude: point.longitude,
        run,
        startTime: validTime,
        endTime: validTime,
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        source: "s3",
      },
    });
    expect(result.model).toBe("gfs_0p50");
    expect(getGfs).toHaveBeenCalledWith(expect.objectContaining({ grid: "0p50" }));
  });
});