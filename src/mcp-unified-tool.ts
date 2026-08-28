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
    description: "Search one canonical catalog across operational GFS, GEFS, deterministic ECMWF IFS, ECMWF IFS ENS, and historical GFS analysis. Results use shared variable/field/diagnostic IDs and explicitly list which datasets support each match. IFS ENS exposes canonical IFS pressure variables and fields as member-first point distributions and native-cadence point time series, plus instant member-first layer/profile/parcel diagnostics.",
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
    description: "Query GFS, GEFS, deterministic ECMWF IFS, ECMWF IFS ENS, or historical GFS analysis through one dataset × geometry × time × selection contract. IFS ENS uses dataset 'ifs-ens' and supports one point at one valid time or a point time range with p01..p50 perturbed members, distribution summaries, optional size-guarded raw member payloads, canonical pressure variables, and selected IFS surface fields. One initialization is pinned across a range and ECMWF's native 3h/6h ENS cadence is preserved. Since ECMWF Cycle 50r1 the unperturbed ENS control is identical to deterministic oper/fc and is exposed separately as dataset 'ifs'. Deterministic IFS retains its broader point/range/multi-point/transect/area support. Dataset-native semantics stay explicit and member-derived quantities are computed inside each member before aggregation.",
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
    description: "Run shared WFG diagnostic physics through one point/time contract. GFS, GEFS, deterministic ECMWF IFS, ECMWF IFS ENS, and historical GFS analysis support layer, whole-profile and parcel diagnostics plus diagnostic time series. GEFS and IFS ENS diagnostics are calculated independently inside each member/perturbation before aggregation; raw member event fractions are explicitly not calibrated probabilities. IFS ENS ranges pin one initialization, preserve ECMWF's native 3h/6h cadence, and return compact member-first summaries.",
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
