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
import { toPublicFailure } from "./failure.js";
import { describedSchema } from "./mcp-tool-schema.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
  unifiedAtmosphereResultSchema,
  type DiagnoseAtmosphereInput,
  type QueryAtmosphereInput,
} from "./schema/unified-api.js";
import {
  searchAtmosphereCatalogSchema,
  unifiedCatalogResultSchema,
  type SearchAtmosphereCatalogInput,
} from "./schema/unified-catalog.js";
import {
  ATMOSPHERIC_DATASET_COMPARISON_PAIRS,
  compareAtmosphericDatasetsInputSchema,
  compareAtmosphericRunsSchema,
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastInputSchema,
  type CompareAtmosphericDatasetsInput,
  type CompareAtmosphericRunsInput,
  type FindAtmosphericAnalogsInput,
  type VerifyAtmosphericForecastInput,
} from "./schema/unified-specialized.js";

const PUBLIC_DATASET_DESCRIPTION = PUBLIC_ATMOSPHERIC_DATASET_IDS.join(", ");
const DATASET_COMPARISON_DESCRIPTION = ATMOSPHERIC_DATASET_COMPARISON_PAIRS
  .map(([left, right]) => `${left}↔${right}`)
  .join(", ");

export function registerUnifiedAtmosphereTools(server: McpServer): void {
  const queryService = new UnifiedAtmosphereQueryService();
  const diagnosticService = new UnifiedAtmosphereDiagnosticService();
  const runComparisonService = new UnifiedRunComparisonService();
  const datasetComparisonService = new UnifiedDatasetComparisonService();
  const verificationService = new UnifiedForecastVerificationService();
  const analogService = new UnifiedAnalogService();

  server.registerTool("search_catalog", {
    title: "Search atmospheric datasets and capabilities",
    description: "Search one canonical catalog across all atmospheric datasets. Results use shared variable, field and diagnostic IDs and explicitly list which datasets support each match. Use spatialScope and coverage to discover global or limited-area datasets that fully cover a point or bounded area; capability rows expose native grid, nominal resolution, cadence and horizon. For GEFS, forecastKind can distinguish operational capabilities from the narrower GEFSv12 reforecast subset, so retrospective queries are discoverable without pretending operational-only diagnostics exist.",
    inputSchema: describedSchema(searchAtmosphereCatalogSchema),
    outputSchema: unifiedCatalogResultSchema,
  }, async (query) => {
    try {
      return toolResult(searchAtmosphereCatalog(query as SearchAtmosphereCatalogInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("query_atmosphere", {
    title: "Query atmospheric state",
    description: `Query atmospheric state through one dataset × geometry × time × selection contract across every public dataset: ${PUBLIC_DATASET_DESCRIPTION}. Dataset-native domain, cadence, grid, provenance, deterministic/member-first semantics and capability limits stay explicit; unsupported combinations fail rather than being coerced into fake symmetry.`,
    inputSchema: describedSchema(queryAtmosphereSchema),
    outputSchema: unifiedAtmosphereResultSchema,
  }, async (query) => {
    try {
      return toolResult(await queryService.query(query as QueryAtmosphereInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("diagnose_atmosphere", {
    title: "Derive atmospheric diagnostics",
    description: "Run shared layer, profile or parcel physics through the same dataset and point/time vocabulary. Deterministic datasets evaluate the shared kernels once; ensemble datasets evaluate nonlinear diagnostics member by member before aggregation. Dataset-native cadence and capability limits remain explicit; AIGFS, AIGEFS and HGEFS do not expose parcel diagnostics because the AI constituent surface inventory lacks the required parcel initialization state, while AIFS and AIFS ENS currently expose layer/profile diagnostics but keep parcel diagnostics as an explicit capability boundary; AIGEFS, HGEFS and AIFS ENS evaluate supported diagnostics member by member before aggregation; HGEFS additionally preserves GEFS-versus-AIGEFS constituent identity.",
    inputSchema: describedSchema(diagnoseAtmosphereSchema),
    outputSchema: unifiedAtmosphereResultSchema,
  }, async (query) => {
    try {
      return toolResult(await diagnosticService.diagnose(query as DiagnoseAtmosphereInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("compare_runs", {
    title: "Compare forecast runs",
    description: "Compare forecast initialization cycles for GFS, GEFS, deterministic ECMWF IFS, or ECMWF IFS ENS through one dataset-aware contract. Deterministic GFS and IFS return newer-minus-older changes; GEFS and IFS ENS return shifts between independently summarized ensemble distributions and never treat member labels as trajectories. IFS ENS can compare 6-hourly cycles or use a 12-hour stride for long-range 00/12Z ensemble comparisons.",
    inputSchema: describedSchema(compareAtmosphericRunsSchema),
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await runComparisonService.compare(query as CompareAtmosphericRunsInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("compare_datasets", {
    title: "Compare atmospheric datasets",
    description: `Compare only explicitly registered, scientifically compatible atmospheric dataset pairs at one point and valid time. Registered pairs: ${DATASET_COMPARISON_DESCRIPTION}. Pair contracts choose pressure-level or field selection explicitly. Global↔regional strategies require one shared explicit initialization cycle, sample each native grid independently at the requested coordinate, and never silently regrid or downscale. Ensemble comparisons preserve native populations and never pair member labels as trajectories. Differences, spread shifts, and raw member fractions are descriptive model evidence, not forecast error or calibrated uncertainty.`,
    inputSchema: describedSchema(compareAtmosphericDatasetsInputSchema),
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await datasetComparisonService.compare(query as CompareAtmosphericDatasetsInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("verify_forecast", {
    title: "Verify an archived forecast",
    description: "Verify archived GFS forecasts against either later GFS analysis or IGRA v2.2 radiosondes. Atomic form uses time.at plus one leadHours value. Both references support a bounded skill-summary form using time.from/time.to plus up to three leadHours values: WFG deterministically samples at most eight nominal verification times and aggregates count, signed bias, MAE and RMSE by lead × pressure × field while retaining failed evaluations explicitly. GFS-analysis summaries are analysis-minus-forecast on the native 0.5° Grid 4 archive; IGRA summaries are observation-minus-forecast and may select an explicit or nearby station. IGRA remains a verification reference here, not a gridded query_atmosphere dataset.",
    inputSchema: describedSchema(verifyAtmosphericForecastInputSchema),
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await verificationService.verify(query as VerifyAtmosphericForecastInput));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("find_analogs", {
    title: "Find historical atmospheric analogs",
    description: "Find locally materialized historical analyses similar to one target atmospheric profile. The current dataset is gfs-analysis; similarity uses the existing standardized profile metric and U/V wind representation. This is model-state similarity, not climatological rarity or impact-specific similarity.",
    inputSchema: describedSchema(findAtmosphericAnalogsSchema),
    outputSchema: unifiedSpecializedResultSchema,
  }, async (query) => {
    try {
      return toolResult(await analogService.find(query as FindAtmosphericAnalogsInput));
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

export function toolError(error: unknown) {
  const failure = toPublicFailure(error);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: failure }),
    }],
    isError: true as const,
  };
}
