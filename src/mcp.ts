import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import { handleGetGfsCatalog, handleGetGfsProfile, handleGetGfsTimeSeries, handleGetLatestGfsRun } from "./mcp-tool.js";
import { profileQuerySchema, timeSeriesQuerySchema } from "./schema/query.js";

const sourceProvenanceSchema = z.object({
  provider: z.union([z.literal("NOAA NOMADS"), z.literal("NOAA AWS Open Data")]),
  access: z.union([z.literal("nomads_grib_filter"), z.literal("s3_range")]),
  decoder: z.literal("wgrib2"),
});

const profileLevelSchema = z.object({
  pressureHpa: z.number(),
  temperatureC: z.number().optional(),
  relativeHumidityPct: z.number().optional(),
  uWindMs: z.number().optional(),
  vWindMs: z.number().optional(),
  geopotentialHeightGpm: z.number().optional(),
  specificHumidityKgKg: z.number().optional(),
  verticalVelocityPaS: z.number().optional(),
  geometricVerticalVelocityMs: z.number().optional(),
  absoluteVorticityS1: z.number().optional(),
  totalCloudCoverPct: z.number().optional(),
  cloudWaterMixingRatioKgKg: z.number().optional(),
  ozoneMixingRatioKgKg: z.number().optional(),
  windSpeedMs: z.number().optional(),
  windDirectionDeg: z.number().optional(),
});

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions:
        "Use get_gfs_catalog to discover supported pressure-level variables and levels. Use get_gfs_profile for one valid time and get_gfs_timeseries for a range. Omit run to use the latest complete GFS cycle. Values are model data, not interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const timeSeriesService = new TimeSeriesService({ latestRunProvider: latestRunResolver, profileGetter: profileService });

  server.registerTool(
    "get_gfs_catalog",
    {
      title: "Get supported GFS pressure catalog",
      description: "List pressure-level variables, canonical output fields/units, raw GFS codes, and supported isobaric levels.",
      inputSchema: z.object({}),
    },
    async () => handleGetGfsCatalog(),
  );

  server.registerTool(
    "get_latest_gfs_run",
    {
      title: "Get latest complete GFS run",
      description: "Resolve the latest complete NOAA GFS 0.25° cycle using NOAA's public cloud mirror.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        model: z.literal("gfs_0p25"), run: z.string(), completeness: z.literal("f384"), discoverySource: z.literal("NOAA AWS Open Data"),
      }),
    },
    async () => handleGetLatestGfsRun(latestRunResolver),
  );

  server.registerTool(
    "get_gfs_profile",
    {
      title: "Get GFS pressure profile",
      description: "Return supported atmospheric fields from NOAA GFS 0.25° at requested pressure levels for one point and valid time.",
      inputSchema: profileQuerySchema,
      outputSchema: z.object({
        model: z.literal("gfs_0p25"), run: z.string(), validTime: z.string(), forecastHour: z.number(),
        requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        levels: z.array(profileLevelSchema),
        source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
      }),
    },
    async (query) => handleGetGfsProfile(profileService, query),
  );

  server.registerTool(
    "get_gfs_timeseries",
    {
      title: "Get GFS point time series",
      description: "Return native GFS outputs inside a valid-time range for one point and selected pressure-level variables.",
      inputSchema: timeSeriesQuerySchema,
      outputSchema: z.object({
        model: z.literal("gfs_0p25"), run: z.string(), requestedStartTime: z.string(), requestedEndTime: z.string(),
        requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        source: sourceProvenanceSchema,
        series: z.array(z.object({ validTime: z.string(), forecastHour: z.number(), levels: z.array(profileLevelSchema), cacheHit: z.boolean() })),
      }),
    },
    async (query) => handleGetGfsTimeSeries(timeSeriesService, query),
  );

  return server;
}

void serveStdio(createServer);
