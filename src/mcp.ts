import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { TimeSeriesService } from "./core/time-series.js";
import {
  handleGetGfsAreaSummary,
  handleGetGfsCatalog,
  handleGetGfsProfile,
  handleGetGfsTimeSeries,
  handleGetLatestGfsRun,
} from "./mcp-tool.js";
import { areaSummaryQuerySchema, profileQuerySchema, timeSeriesQuerySchema } from "./schema/query.js";
import {
  areaSummaryResultSchema,
  latestGfsRunResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "./schema/result.js";

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions: "Use get_gfs_catalog to discover pressure-level and non-isobaric GFS fields. For profile, time-series, and area tools, run='latest' selects the newest GFS cycle whose published data can satisfy the requested valid time/range and exact field selection; run='latest_complete' selects the newest cycle published through f384. Explicit run timestamps remain reproducible. get_gfs_profile and get_gfs_timeseries can mix isobaric variables with surface, height-above-ground, named-layer, named-level, accumulation, and forecast-average fields. Interval-valued products carry explicit start/end intervals. summarize_gfs_area remains pressure-level only. Values are model data, not interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const timeSeriesService = new TimeSeriesService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
  const areaSummaryService = new AreaSummaryService({ latestRunProvider: latestRunResolver });

  server.registerTool("get_gfs_catalog", {
    title: "Get supported GFS field catalog",
    description: "List pressure-level variables and supported non-isobaric surface, height-above-ground, named-layer, named-level, accumulation, and forecast-average fields with canonical outputs and units.",
    inputSchema: z.object({}),
  }, async () => handleGetGfsCatalog());

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run",
    description: "Resolve the latest complete NOAA GFS 0.25° cycle published through f384. Query tools use run='latest' for query-aware newest-available selection instead.",
    inputSchema: z.object({}),
    outputSchema: latestGfsRunResultSchema,
  }, async () => handleGetLatestGfsRun(latestRunResolver));

  server.registerTool("get_gfs_profile", {
    title: "Get GFS point fields",
    description: "Return supported NOAA GFS 0.25° pressure levels and/or non-isobaric fields for one point and valid time. run='latest' resolves the newest cycle containing the exact requested fields at that valid time; run='latest_complete' forces the newest f384-complete cycle.",
    inputSchema: profileQuerySchema,
    outputSchema: profileResultSchema,
  }, async (query) => handleGetGfsProfile(profileService, query));

  server.registerTool("get_gfs_timeseries", {
    title: "Get GFS point time series",
    description: "Return native GFS outputs inside a valid-time range for one point, including pressure-level and/or non-isobaric fields with explicit vertical and temporal semantics. run='latest' resolves the newest single cycle that can cover the requested range and field selection.",
    inputSchema: timeSeriesQuerySchema,
    outputSchema: timeSeriesResultSchema,
  }, async (query) => handleGetGfsTimeSeries(timeSeriesService, query));

  server.registerTool("summarize_gfs_area", {
    title: "Summarize GFS field over an area",
    description: "Return bounded-area min, max, and unweighted grid-point mean for one raw GFS pressure-level variable and valid time. run='latest' resolves the newest cycle containing that field/time. Uses NOMADS geographic subsetting and does not return the raw grid.",
    inputSchema: areaSummaryQuerySchema,
    outputSchema: areaSummaryResultSchema,
  }, async (query) => handleGetGfsAreaSummary(areaSummaryService, query));

  return server;
}

void serveStdio(createServer);
