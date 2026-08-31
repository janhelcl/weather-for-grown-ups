import type { McpServer } from "@modelcontextprotocol/server";
import { searchAtmosphereCatalog } from "./catalog/unified-search.js";
import {
  UnifiedAnalogService,
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
  UnifiedDatasetComparisonService,
  UnifiedForecastVerificationService,
  UnifiedRunComparisonService,
} from "./core/unified-atmosphere-api.js";
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
    description: "Search one canonical catalog across all atmospheric datasets. Results use shared variable, field and diagnostic IDs and explicitly list which datasets support each match. For GEFS, forecastKind can distinguish operational capabilities from the narrower GEFSv12 reforecast subset, so retrospective queries are discoverable without pretending operational-only diagnostics exist.",
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
    description: "Query atmospheric state through one dataset × geometry × time × selection contract across GFS, NOAA AIGFS, NOAA AIGEFS, GEFS, deterministic ECMWF IFS, ECMWF AIFS, ECMWF IFS ENS, and historical GFS analysis. Dataset-native cadence, provenance, deterministic/member-first semantics and capability limits stay explicit; unsupported combinations fail rather than being coerced into fake symmetry.",
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
    description: "Run shared layer, profile or parcel physics through the same dataset and point/time vocabulary. Deterministic datasets evaluate the shared kernels once; ensemble datasets evaluate nonlinear diagnostics member by member before aggregation. Dataset-native cadence and capability limits remain explicit; AIGFS and AIGEFS do not expose parcel diagnostics because their operational surface inventory lacks the required parcel initialization state, while AIFS currently exposes layer/profile diagnostics but keeps parcel diagnostics as an explicit capability boundary; AIGEFS evaluates supported diagnostics member by member before aggregation.",
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
    description: "Compare forecast initialization cycles for GFS, GEFS, deterministic ECMWF IFS, or ECMWF IFS ENS through one dataset-aware contract. Deterministic GFS and IFS return newer-minus-older changes; GEFS and IFS ENS return shifts between independently summarized ensemble distributions and never treat member labels as trajectories. IFS ENS can compare 6-hourly cycles or use a 12-hour stride for long-range 00/12Z ensemble comparisons.",
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
    description: "Compare aligned atmospheric datasets at one point, valid time, pressure variable, and pressure level. GFS↔GEFS places deterministic GFS inside the aligned GEFS member distribution. GFS↔IFS compares normalized deterministic outputs from one shared initialization cycle. GEFS↔IFS ENS compares independently summarized member-first distributions from one common cycle, including mean/spread/quantile shifts and optional raw threshold-fraction differences; member labels are never paired across centers. IFS↔IFS ENS places the deterministic IFS unperturbed control inside its aligned 50-perturbation ENS distribution and reports rank, standardized offset, and member-range position without inventing a 51st member. Dataset-native semantics remain explicit; model differences and raw member fractions are not forecast error or calibrated uncertainty.",
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
