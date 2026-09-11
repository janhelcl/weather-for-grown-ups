import type { McpServer } from "@modelcontextprotocol/server";
import { inspectAtmosphereCapabilities } from "./catalog/capability-inspection.js";
import { searchAtmosphereCatalog } from "./catalog/unified-search.js";
import { lazyAsync } from "./util/lazy-async.js";
import { toPublicFailure } from "./failure.js";
import { describedSchema } from "./mcp-tool-schema.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  diagnoseAtmosphereSchema,
  unifiedAtmosphereResultSchema,
  type DiagnoseAtmosphereInput,
} from "./schema/unified-api.js";
import { queryAtmosphereInputSchema, type PublicQueryAtmosphereInput } from "./schema/unified-query-input.js";
import { searchAtmosphereCatalogSchema, unifiedCatalogResultSchema, type SearchAtmosphereCatalogInput } from "./schema/unified-catalog.js";
import {
  capabilityInspectionResultSchema,
  inspectAtmosphereCapabilitiesSchema,
  type InspectAtmosphereCapabilitiesInput,
} from "./schema/capability-inspection.js";
import {
  atmosphereAvailabilityResultSchema,
  inspectAtmosphereAvailabilitySchema,
  type InspectAtmosphereAvailabilityInput,
} from "./schema/availability-inspection.js";
import {
  alignAtmosphereResultSchema,
  alignAtmosphereSchema,
  type AlignAtmosphereInput,
  type AlignAtmosphereResult,
} from "./schema/unified-alignment.js";
import {
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastInputSchema,
  type FindAtmosphericAnalogsInput,
  type VerifyAtmosphericForecastInput,
} from "./schema/unified-specialized.js";

const PUBLIC_DATASET_DESCRIPTION = PUBLIC_ATMOSPHERIC_DATASET_IDS.join(", ");
const MCP_INTERNAL_ERROR_MESSAGE = "Unexpected internal error while handling the request";

export function registerUnifiedAtmosphereTools(server: McpServer): void {
  const queryService = lazyAsync(async () => {
    const { UnifiedAtmosphereQueryService } = await import("./core/unified-atmosphere-api.js");
    return new UnifiedAtmosphereQueryService();
  });
  const availabilityService = lazyAsync(async () => {
    const { AtmosphericAvailabilityService } = await import("./core/atmospheric-availability.js");
    return new AtmosphericAvailabilityService();
  });
  const diagnosticService = lazyAsync(async () => {
    const { UnifiedAtmosphereDiagnosticService } = await import("./core/unified-atmosphere-api.js");
    return new UnifiedAtmosphereDiagnosticService();
  });
  const alignmentService = lazyAsync(async () => {
    const { UnifiedAtmosphereAlignmentService } = await import("./core/unified-atmosphere-api.js");
    return new UnifiedAtmosphereAlignmentService();
  });
  const verificationService = lazyAsync(async () => {
    const { UnifiedForecastVerificationService } = await import("./core/unified-atmosphere-api.js");
    return new UnifiedForecastVerificationService();
  });
  const analogService = lazyAsync(async () => {
    const { UnifiedAnalogService } = await import("./core/unified-atmosphere-api.js");
    return new UnifiedAnalogService();
  });

  server.registerTool("search_catalog", {
    title: "Search atmospheric datasets and capabilities",
    description: "Explore one canonical catalog across all atmospheric datasets. Use this for discovery when you do not yet know the exact variable, field, diagnostic or dataset. Results list matching canonical IDs and dataset support; capability rows expose native grid, nominal resolution, cadence and horizon. All search words must match; use fewer words to broaden discovery. To page through results, pass nextOffset as offset with the same filters. For a focused yes/no planning decision about one known dataset and requested selections, use inspect_capabilities instead of parsing a broad catalog result.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: describedSchema(searchAtmosphereCatalogSchema), outputSchema: unifiedCatalogResultSchema,
  }, toolHandler(async (query) =>
    searchAtmosphereCatalog(query as SearchAtmosphereCatalogInput)));

  server.registerTool("inspect_capabilities", {
    title: "Inspect exact atmospheric capabilities",
    description: "Check declared contract support for one dataset and an optional planned operation, geometry, selection, diagnostic, run selector, ensemble selection or source override without fetching weather data. Returns a compact supported/unsupported decision, focused reasons, supported geometry types and canonical model metadata. For live initialization and requested valid-time coverage, use inspect_availability.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: describedSchema(inspectAtmosphereCapabilitiesSchema), outputSchema: capabilityInspectionResultSchema,
  }, toolHandler(async (query) =>
    inspectAtmosphereCapabilities(query as InspectAtmosphereCapabilitiesInput)));

  server.registerTool("inspect_availability", {
    title: "Inspect requested forecast-window availability",
    description: "Preflight the same request shape as query_atmosphere before downloading forecast payloads. Checks declared domain/capabilities, resolves the latest suitable published initialization through dataset-native product/index probes, and reports complete, partial or absent requested valid-time coverage plus native cadence and horizon. Explicit run IDs are checked against their declared native window rather than falsely claimed as live-probed.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(inspectAtmosphereAvailabilitySchema), outputSchema: atmosphereAvailabilityResultSchema,
  }, toolHandler(async (query) =>
    await (await availabilityService()).inspect(query as InspectAtmosphereAvailabilityInput)));

  server.registerTool("query_atmosphere", {
    title: "Query atmospheric state",
    description: `Query atmospheric state through one dataset × geometry × time × selection contract across every public dataset: ${PUBLIC_DATASET_DESCRIPTION}. Selection may be omitted for the dataset-aware default. Dataset-native domain, cadence, grid, provenance, deterministic/member-first semantics and capability limits stay explicit; unsupported combinations fail rather than being coerced into fake symmetry.`,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(queryAtmosphereInputSchema), outputSchema: unifiedAtmosphereResultSchema,
  }, toolHandler(async (query) =>
    await (await queryService()).query(query as PublicQueryAtmosphereInput)));

  server.registerTool("diagnose_atmosphere", {
    title: "Derive atmospheric diagnostics",
    description: "Run shared layer, profile or parcel physics through the same dataset and point/time vocabulary. Deterministic datasets evaluate the shared kernels once; ensemble datasets evaluate nonlinear diagnostics member by member before aggregation. Dataset-native cadence and capability limits remain explicit; AIGFS, AIGEFS and HGEFS do not expose parcel diagnostics because the AI constituent surface inventory lacks the required parcel initialization state, while AIFS and AIFS ENS currently expose layer/profile diagnostics but keep parcel diagnostics as an explicit capability boundary; AIGEFS, HGEFS and AIFS ENS evaluate supported diagnostics member by member before aggregation; HGEFS additionally preserves GEFS-versus-AIGEFS constituent identity.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(diagnoseAtmosphereSchema), outputSchema: unifiedAtmosphereResultSchema,
  }, toolHandler(async (query) =>
    await (await diagnosticService()).diagnose(query as DiagnoseAtmosphereInput)));

  server.registerTool("align_atmosphere", {
    title: "Align atmospheric evidence across sources",
    description: "Ask one point × time × selection question of several sources at once and receive one table keyed by canonical quantity and valid time. A source is the dataset-specific part of a query_atmosphere request (dataset plus forecast run/kind/grid, ensemble members/quantiles), so comparing runs of one model, physics against AI, deterministic against ensemble, or global against regional guidance is the same call. WFG owns retrieval, canonical units, run/lead/valid-time and sampled-grid provenance, and the alignment rules: each source samples its own native grid at the requested coordinate with no regridding, ensembles stay independent member-first distributions with no member pairing, directions are flagged circular, and accumulation windows that differ are flagged not comparable. Sources that cannot serve the selection are reported inline with the structured failure instead of being substituted. WFG does not compute or interpret differences; which guidance is warmer, disagrees, or matters remains the caller's statement.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(alignAtmosphereSchema), outputSchema: alignAtmosphereResultSchema,
  }, toolHandler(async (query) =>
    redactEmbeddedInternalFailures(await (await alignmentService()).align(query as AlignAtmosphereInput))));

  server.registerTool("verify_forecast", {
    title: "Verify an archived forecast",
    description: "Verify archived GFS forecasts against either later GFS analysis or IGRA v2.2 radiosondes. Atomic form uses time.at plus one leadHours value. Both references support a bounded skill-summary form using time.from/time.to plus up to three leadHours values: WFG deterministically samples at most eight nominal verification times and aggregates count, signed bias, MAE and RMSE by lead × pressure × field while retaining failed evaluations explicitly. GFS-analysis summaries are analysis-minus-forecast on the native 0.5° Grid 4 archive; IGRA summaries are observation-minus-forecast and may select an explicit or nearby station. IGRA remains a verification reference here, not a gridded query_atmosphere dataset.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(verifyAtmosphericForecastInputSchema), outputSchema: unifiedSpecializedResultSchema,
  }, toolHandler(async (query) =>
    await (await verificationService()).verify(query as VerifyAtmosphericForecastInput)));

  server.registerTool("find_analogs", {
    title: "Find historical atmospheric analogs",
    description: "Find locally materialized historical analyses similar to one target atmospheric profile. A missing target may be fetched and materialized in the local index unless fetchTargetIfMissing is false. The current dataset is gfs-analysis; similarity uses the existing standardized profile metric and U/V wind representation. This is model-state similarity, not climatological rarity or impact-specific similarity.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: describedSchema(findAtmosphericAnalogsSchema), outputSchema: unifiedSpecializedResultSchema,
  }, toolHandler(async (query) =>
    await (await analogService()).find(query as FindAtmosphericAnalogsInput)));
}

/**
 * Per-source failures travel inside a successful alignment result, so they must
 * honor the same MCP rule as toolError: unclassified internal text never leaves
 * the process boundary.
 */
export function redactEmbeddedInternalFailures(result: AlignAtmosphereResult): AlignAtmosphereResult {
  return {
    ...result,
    sources: result.sources.map((source) =>
      source.status === "failed" && source.failure.code === "INTERNAL_ERROR"
        ? { ...source, failure: { ...source.failure, message: MCP_INTERNAL_ERROR_MESSAGE } }
        : source),
  };
}

/** Keep initialization, execution and serialization inside the public failure boundary. */
function toolHandler(execute: (query: unknown) => object | Promise<object>) {
  return async (query: unknown) => {
    try {
      return toolResult(await execute(query));
    } catch (error) {
      return toolError(error);
    }
  };
}

function toolResult(output: object) { return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } }; }
export function toolError(error: unknown) {
  const failure = toPublicFailure(error);
  const publicFailure = failure.code === "INTERNAL_ERROR" ? { ...failure, message: MCP_INTERNAL_ERROR_MESSAGE } : failure;
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: publicFailure }) }], isError: true as const };
}
