import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { ProfileService } from "./core/profile.js";
import { handleGetGfsProfile } from "./mcp-tool.js";
import { profileQuerySchema } from "./schema/query.js";

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions:
        "Use get_gfs_profile for precise GFS pressure-level data. Values are model data, not interpretation or safety advice.",
    },
  );
  const profileService = new ProfileService();

  server.registerTool(
    "get_gfs_profile",
    {
      title: "Get GFS pressure profile",
      description:
        "Return temperature, relative humidity and/or wind from NOAA GFS 0.25° at requested pressure levels for one point and valid time.",
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
          provider: z.literal("NOAA NOMADS"),
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
