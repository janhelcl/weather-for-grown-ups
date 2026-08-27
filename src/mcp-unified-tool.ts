import type { McpServer } from "@modelcontextprotocol/server";
import { searchAtmosphereCatalog } from "./catalog/unified-search.js";
import {
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
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

export function registerUnifiedAtmosphereTools(server: McpServer): void {
  const queryService = new UnifiedAtmosphereQueryService();
  const diagnosticService = new UnifiedAtmosphereDiagnosticService();

  server.registerTool("search_catalog", {
    title: "Search atmospheric datasets and capabilities",
    description: "Search one canonical catalog across operational GFS, GEFS, and historical GFS analysis. Results use shared variable/field/diagnostic IDs and explicitly list which datasets support each match. This is the preferred discovery tool for the unified WFG API.",
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
    description: "Query GFS, GEFS, or historical GFS analysis through one dataset × geometry × time × selection contract. Geometry may be one point, multiple points, a transect, or an area; point geometries also accept time ranges. The result preserves dataset-native semantics: deterministic forecasts remain deterministic, GEFS remains member-first ensemble distributions, and historical analysis keeps analysis-time/NCEI provenance without invented forecast metadata.",
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
    description: "Run the shared WFG layer, whole-profile, or parcel physics on GFS, GEFS, or historical GFS analysis using one point/time contract. A time range produces a diagnostic series. GEFS diagnostics are calculated independently per member before aggregation; historical diagnostics use the same deterministic kernels on analyzed states.",
    inputSchema: diagnoseAtmosphereSchema,
    outputSchema: unifiedAtmosphereResultSchema,
  }, async (query) => {
    try {
      return toolResult(await diagnosticService.diagnose(query));
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
