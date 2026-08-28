import { McpServer } from "@modelcontextprotocol/server";
import { registerUnifiedAtmosphereTools } from "./mcp-unified-tool.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions: [
        "WFG exposes one atmospheric query language across operational GFS, GEFS, and historical GFS analysis.",
        "Use search_catalog for discovery, query_atmosphere for atmospheric state, diagnose_atmosphere for layer/profile/parcel physics, compare_runs and compare_datasets for forecast comparison, verify_forecast for archived GFS verification, and find_analogs for local historical analog search.",
        "Public dataset IDs are gfs, gefs, ifs, ifs-ens, and gfs-analysis. Use the same dataset × geometry × time × selection vocabulary across them. Dataset-native semantics are preserved: GFS and IFS are deterministic forecasts, GEFS and IFS ENS are member-first ensemble forecasts, and gfs-analysis is historical model analysis rather than observations or homogeneous reanalysis.",
        "GEFS member fractions and distributions are raw ensemble evidence, not calibrated probability. WFG does not provide activity-specific interpretation or safety advice.",
      ].join(" "),
    },
  );

  registerUnifiedAtmosphereTools(server);
  return server;
}
