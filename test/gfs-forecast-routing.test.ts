import { describe, expect, it, vi } from "vitest";
import {
  DataUnavailableError,
  UpstreamUnavailableError,
} from "../src/failure.js";
import { ArchivedGfsForecastProfileService } from "../src/core/history-forecast.js";
import { AwsGfsForecastAnalysisSource } from "../src/sources/gfs-forecast-aws.js";
import { buildNceiGfsForecastFileServerUrl } from "../src/sources/gfs-forecast-fileserver.js";
import { RoutedGfs0p50ForecastAnalysisSource } from "../src/sources/gfs-forecast-routed.js";
import type {
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisSource,
} from "../src/sources/gfs-analysis.js";
import { NCEI_NCSS_PROVENANCE } from "../src/sources/ncei-gfs-history.js";
import { buildGfsS3ForecastIndexUrl } from "../src/sources/gfs-s3.js";

const cycle = {
  runTime: new Date("2024-06-01T00:00:00Z"),
  forecastHour: 12,
  validTime: new Date("2024-06-01T12:00:00Z"),
};

const preAwsCycle = {
  runTime: new Date("2017-05-07T12:00:00Z"),
  forecastHour: 48,
  validTime: new Date("2017-05-09T12:00:00Z"),
};

function ncssPointResponse(): HistoricalAnalysisPointResponse {
  return {
    rows: [{
      latitude: 50,
      longitude: 14.5,
      pressureHpa: 850,
      values: { temperature: 285.15 },
    }],
    dataset: "ncss-forecast",
    cacheHit: false,
    ...NCEI_NCSS_PROVENANCE,
  };
}

function ncssAreaResponse(): HistoricalAnalysisAreaResponse {
  return {
    variable: "temperature",
    points: [{ latitude: 50, longitude: 14, value: 285.15 }],
    verticalCoordinate: 85000,
    dataset: "ncss-forecast-area",
    cacheHit: false,
    ...NCEI_NCSS_PROVENANCE,
  };
}

describe("archived GFS 0.50° forecast routing", () => {
  it("builds the NCEI fileServer URL from the Grid 4 forecast path", () => {
    expect(buildNceiGfsForecastFileServerUrl(new Date("2017-05-07T12:00:00Z"), 48)).toBe(
      "https://www.ncei.noaa.gov/thredds/fileServer/model-gfs-004-files-old/201705/20170507/gfs_4_20170507_1200_048.grb2",
    );
  });

  it("prefers AWS for ≥2021 and falls back to NCSS when AWS is unavailable", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new UpstreamUnavailableError("AWS down", { details: { provider: "NOAA AWS Open Data" } });
      }),
      fetchArea: vi.fn(),
    };
    const fileServer = { fetch: vi.fn() };
    const ncss = {
      fetch: vi.fn(async () => ncssPointResponse()),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfs0p50ForecastAnalysisSource(cycle, { aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: cycle.validTime,
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    });
    expect(result.access).toBe("ncei_thredds_ncss");
    expect(aws.fetch).toHaveBeenCalledTimes(1);
    expect(fileServer.fetch).not.toHaveBeenCalled();
    expect(ncss.fetch).toHaveBeenCalledTimes(1);
  });

  it("prefers fileServer for pre-2021 point queries and falls back to NCSS", async () => {
    const aws = { fetch: vi.fn(), fetchArea: vi.fn() };
    const fileServer = {
      fetch: vi.fn(async () => {
        throw new DataUnavailableError("file missing", { details: { provider: "NOAA NCEI" } });
      }),
    };
    const ncss = {
      fetch: vi.fn(async () => ncssPointResponse()),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfs0p50ForecastAnalysisSource(preAwsCycle, { aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: preAwsCycle.validTime,
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    });
    expect(result.dataset).toBe("ncss-forecast");
    expect(aws.fetch).not.toHaveBeenCalled();
    expect(fileServer.fetch).toHaveBeenCalledTimes(1);
    expect(ncss.fetch).toHaveBeenCalledTimes(1);
  });

  it("routes pre-2021 area requests directly to NCSS", async () => {
    const fileServer = { fetch: vi.fn() };
    const ncss = {
      fetch: vi.fn(),
      fetchArea: vi.fn(async () => ncssAreaResponse()),
    };
    const routed = new RoutedGfs0p50ForecastAnalysisSource(preAwsCycle, {
      aws: { fetch: vi.fn(), fetchArea: vi.fn() },
      fileServer,
      ncss,
    });
    const result = await routed.fetchArea({
      analysisTime: preAwsCycle.validTime,
      westLongitude: 13,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 51,
      variable: "temperature",
      verticalCoordinate: 85000,
    });
    expect(result.dataset).toBe("ncss-forecast-area");
    expect(fileServer.fetch).not.toHaveBeenCalled();
    expect(ncss.fetchArea).toHaveBeenCalledTimes(1);
  });

  it("refuses AWS forecast requests before the Open Data archive start", async () => {
    const source = new AwsGfsForecastAnalysisSource(preAwsCycle, {
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(source.fetch({
      analysisTime: preAwsCycle.validTime,
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).rejects.toThrow("begins at 2021-01-01");
    expect(buildGfsS3ForecastIndexUrl(cycle.runTime, 12, "0p50"))
      .toContain("/atmos/gfs.t00z.pgrb2.0p50.f012.idx");
  });

  it("requires nceiAccessPolicy when constructing real fileServer/NCSS children", () => {
    expect(() => new RoutedGfs0p50ForecastAnalysisSource(cycle, {})).toThrow(/nceiAccessPolicy/);
  });
});

describe("ArchivedGfsForecastProfileService AWS routing", () => {
  it("uses an injected routed 0.50° source and reports its provenance", async () => {
    const routed: HistoricalAnalysisSource = {
      fetch: vi.fn(async () => ({
        rows: [{
          latitude: 50,
          longitude: 14.5,
          pressureHpa: 850,
          values: { temperature: 283.15 },
        }],
        dataset: "noaa-gfs-bdp-pds/gfs.20240601/00/atmos/gfs.t00z.pgrb2.0p50.f012",
        cacheHit: false,
        provider: "NOAA AWS Open Data",
        access: "s3_range",
      })),
      fetchArea: vi.fn(),
    };
    const service = new ArchivedGfsForecastProfileService({
      routed0p50: routed,
      now: () => new Date("2026-08-26T12:00:00Z"),
    });
    const result = await service.getArchivedForecastProfile({
      runTime: cycle.runTime,
      forecastHour: 12,
      latitude: 50.08,
      longitude: 14.43,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect(result.source).toMatchObject({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
    });
    expect(result.levels[0]).toMatchObject({ pressureHpa: 850, temperatureC: 10 });
  });
});
