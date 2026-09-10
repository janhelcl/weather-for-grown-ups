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
        "Use search_catalog to explore when you do not yet know the canonical field, diagnostic or dataset. Once the planned dataset/query shape is known, use inspect_capabilities for a compact declared-support decision and inspect_availability when the next question is whether that same place and valid-time window can actually be served by a suitable forecast initialization before downloading forecast payloads. Use query_atmosphere for atmospheric state, diagnose_atmosphere for layer/profile/parcel physics, align_atmosphere to ask the same question of several datasets, runs or member populations and receive one canonically aligned evidence table, verify_forecast for archived GFS verification, and find_analogs for local historical analog search.",
        "Capability inspection is static contract metadata; availability inspection adds dataset-native initialization/product probing and reports complete, partial or absent requested-window coverage. The public vocabulary is shared, but dataset-native semantics stay explicit: deterministic, ensemble, AI, hybrid, regional, reforecast and historical-analysis products keep their own grids, cadence, members, provenance and capability boundaries. Unsupported combinations fail rather than being coerced into fake symmetry.",
        "Ensemble member fractions, distributions and spread are raw model evidence, not calibrated probability. WFG supplies atmospheric evidence and diagnostics; activity-specific interpretation and safety decisions remain downstream.",
      ].join(" "),
    },
  );

  registerUnifiedAtmosphereTools(server);
  return server;
}