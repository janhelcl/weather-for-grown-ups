import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import { handleGetGfsAreaSummary, handleGetGfsCatalog, handleGetGfsProfile, handleGetGfsTimeSeries, handleGetLatestGfsRun } from "./mcp-tool.js";
import { areaSummaryQuerySchema, profileQuerySchema, timeSeriesQuerySchema } from "./schema/query.js";

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

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    { instructions: "Use get_gfs_catalog to discover supported pressure-level fields. Use get_gfs_profile for a point/time, get_gfs_timeseries for a point/range, and summarize_gfs_area for bounded regional min/max/mean. Area means are unweighted grid-point means. Values are model data, not interpretation or safety advice." },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const timeSeriesService = new TimeSeriesService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
  const areaSummaryService = new AreaSummaryService({ latestRunProvider: latestRunResolver });

  server.registerTool("get_gfs_catalog", {
    title: "Get supported GFS pressure catalog",
    description: "List pressure-level variables, canonical output fields/units, raw GFS codes, and supported isobaric levels.",
    inputSchema: z.object({}),
  }, async () => handleGetGfsCatalog());

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run", description: "Resolve the latest complete NOAA GFS 0.25° cycle using NOAA's public cloud mirror.",
    inputSchema: z.object({}),
    outputSchema: z.object({ model: z.literal("gfs_0p25"), run: z.string(), completeness: z.literal("f384"), discoverySource: z.literal("NOAA AWS Open Data") }),
  }, async () => handleGetLatestGfsRun(latestRunResolver));

  server.registerTool("get_gfs_profile", {
    title: "Get GFS pressure profile", description: "Return supported atmospheric fields from NOAA GFS 0.25° at requested pressure levels for one point and valid time.",
    inputSchema: profileQuerySchema,
    outputSchema: z.object({
      model: z.literal("gfs_0p25"), run: z.string(), validTime: z.string(), forecastHour: z.number(),
      requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }), gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
      levels: z.array(profileLevelSchema), source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
    }),
  }, async (query) => handleGetGfsProfile(profileService, query));

  server.registerTool("get_gfs_timeseries", {
    title: "Get GFS point time series", description: "Return native GFS outputs inside a valid-time range for one point and selected pressure-level variables.",
    inputSchema: timeSeriesQuerySchema,
    outputSchema: z.object({
      model: z.literal("gfs_0p25"), run: z.string(), requestedStartTime: z.string(), requestedEndTime: z.string(),
      requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }), gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
      source: sourceProvenanceSchema,
      series: z.array(z.object({ validTime: z.string(), forecastHour: z.number(), levels: z.array(profileLevelSchema), cacheHit: z.boolean() })),
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
