import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import { handleGetGfsAreaSummary, handleGetGfsCatalog, handleGetGfsProfile, handleGetGfsTimeSeries, handleGetLatestGfsRun } from "./mcp-tool.js";
import { areaSummaryQuerySchema, nonIsobaricFieldIdSchema, profileQuerySchema, timeSeriesQuerySchema } from "./schema/query.js";

const sourceProvenanceSchema = z.object({
  provider: z.union([z.literal("NOAA NOMADS"), z.literal("NOAA AWS Open Data")]),
  access: z.union([z.literal("nomads_grib_filter"), z.literal("s3_range")]),
  decoder: z.literal("wgrib2"),
});

const profileLevelSchema = z.object({
  pressureHpa: z.number(), temperatureC: z.number().optional(), relativeHumidityPct: z.number().optional(),
  uWindMs: z.number().optional(), vWindMs: z.number().optional(), geopotentialHeightGpm: z.number().optional(),
  specificHumidityKgKg: z.number().optional(), verticalVelocityPaS: z.number().optional(),
  geometricVerticalVelocityMs: z.number().optional(), absoluteVorticityS1: z.number().optional(),
  totalCloudCoverPct: z.number().optional(), cloudWaterMixingRatioKgKg: z.number().optional(),
  ozoneMixingRatioKgKg: z.number().optional(), windSpeedMs: z.number().optional(), windDirectionDeg: z.number().optional(),
});

const nonIsobaricLevelSchema = z.union([
  z.object({ type: z.literal("surface") }),
  z.object({ type: z.literal("height_above_ground_m"), heightM: z.number() }),
]);

const fieldTemporalSchema = z.union([
  z.object({ type: z.literal("instantaneous") }),
  z.object({
    type: z.literal("accumulation"),
    startForecastHour: z.number(),
    endForecastHour: z.number(),
    startTime: z.string(),
    endTime: z.string(),
  }),
]);

const nonIsobaricFieldResultSchema = z.object({
  id: nonIsobaricFieldIdSchema,
  level: nonIsobaricLevelSchema,
  temporal: fieldTemporalSchema,
  values: z.record(z.string(), z.number()),
});

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    { instructions: "Use get_gfs_catalog to discover pressure-level and non-isobaric GFS fields. get_gfs_profile and get_gfs_timeseries can mix isobaric variables with surface, height-above-ground, and accumulation fields. Accumulations carry explicit start/end intervals. summarize_gfs_area remains pressure-level only. Values are model data, not interpretation or safety advice." },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const timeSeriesService = new TimeSeriesService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
  const areaSummaryService = new AreaSummaryService({ latestRunProvider: latestRunResolver });

  server.registerTool("get_gfs_catalog", {
    title: "Get supported GFS field catalog",
    description: "List pressure-level variables and supported non-isobaric surface, height-above-ground, and accumulation fields with canonical outputs and units.",
    inputSchema: z.object({}),
  }, async () => handleGetGfsCatalog());

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run", description: "Resolve the latest complete NOAA GFS 0.25° cycle using NOAA's public cloud mirror.",
    inputSchema: z.object({}),
    outputSchema: z.object({ model: z.literal("gfs_0p25"), run: z.string(), completeness: z.literal("f384"), discoverySource: z.literal("NOAA AWS Open Data") }),
  }, async () => handleGetLatestGfsRun(latestRunResolver));

  server.registerTool("get_gfs_profile", {
    title: "Get GFS point fields", description: "Return supported NOAA GFS 0.25° pressure levels and/or non-isobaric surface, height-above-ground, and accumulation fields for one point and valid time.",
    inputSchema: profileQuerySchema,
    outputSchema: z.object({
      model: z.literal("gfs_0p25"), run: z.string(), validTime: z.string(), forecastHour: z.number(),
      requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }), gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
      levels: z.array(profileLevelSchema), fields: z.array(nonIsobaricFieldResultSchema).optional(),
      source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
    }),
  }, async (query) => handleGetGfsProfile(profileService, query));

  server.registerTool("get_gfs_timeseries", {
    title: "Get GFS point time series", description: "Return native GFS outputs inside a valid-time range for one point, including pressure-level and/or non-isobaric fields.",
    inputSchema: timeSeriesQuerySchema,
    outputSchema: z.object({
      model: z.literal("gfs_0p25"), run: z.string(), requestedStartTime: z.string(), requestedEndTime: z.string(),
      requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }), gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
      source: sourceProvenanceSchema,
      series: z.array(z.object({
        validTime: z.string(), forecastHour: z.number(), levels: z.array(profileLevelSchema),
        fields: z.array(nonIsobaricFieldResultSchema).optional(), cacheHit: z.boolean(),
      })),
    }),
  }, async (query) => handleGetGfsTimeSeries(timeSeriesService, query));

  server.registerTool("summarize_gfs_area", {
    title: "Summarize GFS field over an area",
    description: "Return bounded-area min, max, and unweighted grid-point mean for one raw GFS pressure-level variable and valid time. Uses NOMADS geographic subsetting and does not return the raw grid.",
    inputSchema: areaSummaryQuerySchema,
    outputSchema: z.object({
      model: z.literal("gfs_0p25"), run: z.string(), validTime: z.string(), forecastHour: z.number(),
      bbox: z.object({ westLongitude: z.number(), eastLongitude: z.number(), southLatitude: z.number(), northLatitude: z.number() }),
      variable: z.object({ id: z.string(), pressureHpa: z.number(), field: z.string(), unit: z.string() }),
      statistics: z.object({ definedGridPoints: z.number(), mean: z.number(), min: z.number(), max: z.number(), meanKind: z.literal("unweighted_grid_point_mean") }),
      source: z.object({ provider: z.literal("NOAA NOMADS"), access: z.literal("nomads_grib_filter"), decoder: z.literal("wgrib2"), cacheHit: z.boolean() }),
    }),
  }, async (query) => handleGetGfsAreaSummary(areaSummaryService, query));

  return server;
}

void serveStdio(createServer);
