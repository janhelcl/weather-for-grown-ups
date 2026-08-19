import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { LatestRunResolver } from "./core/latest-run.js";
import { ProfileService } from "./core/profile.js";
import { handleGetGfsProfile, handleGetLatestGfsRun } from "./mcp-tool.js";
import { profileQuerySchema } from "./schema/query.js";

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions:
        "Use get_gfs_profile for precise GFS pressure-level data. Omit run to use the latest complete GFS cycle. NOMADS is the default source; use source=s3 to bypass NOMADS pacing by fetching selected GRIB messages from NOAA AWS. Values are model data, not interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });

  server.registerTool(
    "get_latest_gfs_run",
    {
      title: "Get latest complete GFS run",
      description: "Resolve the latest complete NOAA GFS 0.25° cycle using NOAA's public cloud mirror.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        model: z.literal("gfs_0p25"),
        run: z.string(),
        completeness: z.literal("f384"),
        discoverySource: z.literal("NOAA AWS Open Data"),
      }),
    },
    async () => handleGetLatestGfsRun(latestRunResolver),
  );

  server.registerTool(
    "get_gfs_profile",
    {
      title: "Get GFS pressure profile",
      description:
        "Return temperature, relative humidity and/or wind from NOAA GFS 0.25° at requested pressure levels for one point and valid time. Run defaults to the latest complete cycle. Source defaults to NOMADS; source=s3 uses NOAA AWS byte-range access.",
      inputSchema: profileQuerySchema,
      outputSchema: z.object({
        model: z.literal("gfs_0p25"),
        run: z.string(),
        validTime: z.string(),
        forecastHour: z.number(),
        requestedPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        gridPoint: z.object({ latitude: z.number(), longitude: z.number() }),
        levels: z.array(z.object({
          pressureHpa: z.number(),
          temperatureC: z.number().optional(),
          relativeHumidityPct: z.number().optional(),
          uWindMs: z.number().optional(),
          vWindMs: z.number().optional(),
          windSpeedMs: z.number().optional(),
          windDirectionDeg: z.number().optional(),
        })),
        source: z.object({
          provider: z.union([z.literal("NOAA NOMADS"), z.literal("NOAA AWS Open Data")]),
          access: z.union([z.literal("nomads_grib_filter"), z.literal("s3_range")]),
          decoder: z.literal("wgrib2"),
          cacheHit: z.boolean(),
        }),
      }),
    },
    async (query) => handleGetGfsProfile(profileService, query),
  );

  return server;
}

void serveStdio(createServer);
