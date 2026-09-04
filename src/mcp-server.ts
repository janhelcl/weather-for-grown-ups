import { McpServer } from "@modelcontextprotocol/server";
import { registerUnifiedAtmosphereTools } from "./mcp-unified-tool.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "./schema/unified-api.js";
import { WFG_VERSION } from "./version.js";

const PUBLIC_DATASET_DESCRIPTION = PUBLIC_ATMOSPHERIC_DATASET_IDS.join(", ");

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: WFG_VERSION },
    {
      instructions: [
        `WFG exposes one atmospheric query language across public datasets: ${PUBLIC_DATASET_DESCRIPTION}.`,
        "Use search_catalog to discover canonical fields, diagnostics and dataset capabilities before querying. Use query_atmosphere for atmospheric state, diagnose_atmosphere for layer/profile/parcel physics, compare_runs for forecast-cycle changes, compare_datasets for registered cross-model comparisons, verify_forecast for archived GFS verification, and find_analogs for local historical analog search.",
        "The public vocabulary is shared, but dataset-native semantics stay explicit: deterministic, ensemble, AI, hybrid, regional, reforecast and historical-analysis products keep their own grids, cadence, members, provenance and capability boundaries. Unsupported combinations fail rather than being coerced into fake symmetry.",
        "Ensemble member fractions, distributions and spread are raw model evidence, not calibrated probability. WFG supplies atmospheric evidence and diagnostics; activity-specific interpretation and safety decisions remain downstream.",
      ].join(" "),
    },
  );

  registerUnifiedAtmosphereTools(server);
  return server;
}
