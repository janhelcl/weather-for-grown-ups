import type { McpServer } from "@modelcontextprotocol/server";
import { searchAtmosphereCatalog } from "./catalog/unified-search.js";
import {
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
} from "./core/unified-atmosphere-api.js";
import {
  UnifiedAnalogService,
  UnifiedDatasetComparisonService,
  UnifiedForecastVerificationService,
  UnifiedRunComparisonService,
} from "./core/unified-specialized-api.js";
import {
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
  unifiedAtmosphereResultSchema,
} from "./schema/unified-api.js";
import {
  searchAtmosphereCatalogSchema,
  unifiedCatalogResultSchema,
} from "./schema/unified-catalog.js";
import {
  compareAtmosphericDatasetsSchema,
  compareAtmosphericRunsSchema,
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastSchema,
} from "./schema/unified-specialized.js";

export function registerUnifiedAtmosphereTools(server: McpServer): void {
  const queryService = new UnifiedAtmosphereQueryService();
  const diagnosticService = new UnifiedAtmosphereDiagnosticService();
  const runComparisonService = new UnifiedRunComparisonService();
  const datasetComparisonService = new UnifiedDatasetComparisonService();
  const verificationService = new UnifiedForecastVerificationService();
  const analogService = new UnifiedAnalogService();

  server.registerTool("search_catalog", {
    title: "Search atmospheric datasets and capabilities",
    description: "Search one canonical catalog across operational GFS, GEFS, ECMWF IFS, and historical GFS analysis. Results use shared variable/field/diagnostic IDs and explicitly list which datasets support each match. This is the preferred discovery tool for the unified WFG API.",
    inputSchema: searchAtmosphereCatalogSchema,
    outputSchema: unifiedCatalogResultSchema,
  }, async (query) => {
    try {
      return toolResult(searchAtmosphereCatalog(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("query_atmosphere", {
    title: "Query atmospheric state",
    description: "Query GFS, GEFS, ECMWF IFS, or historical GFS analysis through one dataset × geometry × time × selection contract. IFS supports deterministic 0.25° point queries and point time ranges, multi-point instant/range sampling, transects, and raw scalar area statistics with pressure-level variables or selected surface fields. Geometry may be one point, multiple points, a transect, or an area; point geometries also accept time ranges. The result preserves dataset-native semantics: deterministic forecasts remain deterministic, GEFS remains member-first ensemble distributions, and historical analysis keeps analysis-time/NCEI provenance without invented forecast metadata.",
    inputSchema: queryAtmosphereSchema,
    outputSchema: unifiedAtmosphereResultSchema,
  }, async (query) => {
    try {
      return toolResult(await queryService.query(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("diagnose_atmosphere", {
    title: "Derive atmospheric diagnostics",
    description: "Run shared WFG diagnostic physics through one point/time contract. GFS, GEFS, ECMWF IFS, and historical GFS analysis support layer, whole-profile and parcel diagnostics plus diagnostic time series. IFS ranges preserve native ECMWF output cadence and pin one selection-capable forecast initialization across the range. GEFS diagnostics are calculated independently per member before aggregation; deterministic datasets reuse the same normalized physics kernels.",
    inputSchema: diagnoseAtmosphereSchema,
    outputSchema: unifiedAtmosphereResultSchema,
  }, async (query) => {
    try {
      return toolResult(await diagnosticService.diagnose(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("compare_runs", {
    title: "Compare forecast runs",
    description: "Compare consecutive forecast initialization cycles for GFS, GEFS, or ECMWF IFS through one dataset-aware contract. Deterministic GFS and IFS return newer-minus-older changes with circular wind-direction deltas and explicit temporal-window compatibility for fields; GEFS returns shifts between independently summarized member distributions and never treats member labels as trajectories.",
    inputSchema: compareAtmosphericRunsSchema,
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await runComparisonService.compare(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("compare_datasets", {
    title: "Compare atmospheric datasets",
    description: "Compare aligned atmospheric datasets at one point, valid time, pressure variable, and pressure level. GFS↔GEFS places deterministic GFS inside the aligned GEFS member distribution. GFS↔IFS compares normalized deterministic outputs from one shared initialization cycle and returns IFS-minus-GFS deltas, using circular differences for wind direction. Dataset-native semantics remain explicit; model differences are not forecast error or calibrated uncertainty.",
    inputSchema: compareAtmosphericDatasetsSchema,
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await datasetComparisonService.compare(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("verify_forecast", {
    title: "Verify an archived forecast",
    description: "Verify archived GFS forecasts against either later GFS analysis or IGRA v2.2 radiosondes. Atomic form uses time.at plus one leadHours value. Both references support a bounded skill-summary form using time.from/time.to plus up to three leadHours values: WFG deterministically samples at most eight nominal verification times and aggregates count, signed bias, MAE and RMSE by lead × pressure × field while retaining failed evaluations explicitly. GFS-analysis summaries are analysis-minus-forecast on the native 0.5° Grid 4 archive; IGRA summaries are observation-minus-forecast and may select an explicit or nearby station. IGRA remains a verification reference here, not a gridded query_atmosphere dataset.",
    inputSchema: verifyAtmosphericForecastSchema,
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await verificationService.verify(query));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("find_analogs", {
    title: "Find historical atmospheric analogs",
    description: "Find locally materialized historical analyses similar to one target atmospheric profile. The current dataset is gfs-analysis; similarity uses the existing standardized profile metric and U/V wind representation. This is model-state similarity, not climatological rarity or impact-specific similarity.",
    inputSchema: findAtmosphericAnalogsSchema,
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await analogService.find(query));
    } catch (error) {
      return toolError(error);
    }
  });
}

function toolResult(output: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: { ...output },
  };
}

function toolError(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error),
    }],
    isError: true as const,
  };
}
