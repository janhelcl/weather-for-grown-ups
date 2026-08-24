import { GefsBundleTimeSeriesService } from "./core/gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "./core/gefs-member-bundle.js";
import {
  handleGetGefsFields,
  handleGetGefsFieldsTimeSeries,
} from "./mcp-gefs-bundle-tool.js";
import { createMcpServer as createBaseMcpServer } from "./mcp-server.js";
import {
  gefsBundleTimeSeriesQuerySchema,
  gefsBundleTimeSeriesResultSchema,
} from "./schema/gefs-bundle-timeseries.js";
import {
  gefsMemberBundleQuerySchema,
  gefsMemberBundleResultSchema,
} from "./schema/gefs-member-bundle.js";

/**
 * Extend the shared MCP server with GEFS mixed-field bundle operations without
 * duplicating the existing registry. Both stdio and Streamable HTTP entrypoints
 * use this factory, so the public MCP tool catalog remains transport-identical.
 */
export function createMcpServer() {
  const server = createBaseMcpServer();
  const bundleService = new GefsMemberBundleService();
  const timeSeriesService = new GefsBundleTimeSeriesService({ bundleGetter: bundleService });

  server.registerTool("get_gefs_fields", {
    title: "Get mixed GEFS field distributions",
    description: "Fetch one mixed GEFS 0.5° pgrb2a selection at one point/time: multiple pressure variables/levels plus non-isobaric fields such as 2 m temperature/RH, 10 m wind, precipitation, PWAT, cloud cover, CAPE/CIN, or MSLP. WFG merges all raw dependencies into one selected GRIB slice and one wgrib2 decode per member, derives supported thermodynamics and wind member-by-member, then summarizes across members. Accumulation/average intervals are explicit; wind direction uses circular aggregation. Member arrays are optional. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsMemberBundleQuerySchema,
    outputSchema: gefsMemberBundleResultSchema,
  }, async (query) => handleGetGefsFields(bundleService, query));

  server.registerTool("get_gefs_fields_timeseries", {
    title: "Get mixed GEFS field time series",
    description: "Track one mixed GEFS pressure/non-isobaric selection across native three-hour valid times from one fixed model cycle and member set. Each forecast step performs one mixed selected-message fetch/decode per member, preserving field-specific accumulation/average windows and member-first derived values. Compact distribution summaries are returned by default; includeMembers is guarded by maxMemberSamples to bound agent context. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsBundleTimeSeriesQuerySchema,
    outputSchema: gefsBundleTimeSeriesResultSchema,
  }, async (query) => handleGetGefsFieldsTimeSeries(timeSeriesService, query));

  return server;
}
