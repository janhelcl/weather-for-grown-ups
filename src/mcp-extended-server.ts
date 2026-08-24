import { GefsAreaSummaryService } from "./core/gefs-area-summary.js";
import { GefsBundleTimeSeriesService } from "./core/gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "./core/gefs-member-bundle.js";
import { GefsPointsBundleTimeSeriesService } from "./core/gefs-points-bundle-timeseries.js";
import { GefsPointsBundleService } from "./core/gefs-points-bundle.js";
import { GefsTransectService } from "./core/gefs-transect.js";
import { handleGetGefsAreaSummary } from "./mcp-gefs-area-tool.js";
import {
  handleGetGefsFields,
  handleGetGefsFieldsTimeSeries,
} from "./mcp-gefs-bundle-tool.js";
import { handleGetGefsFieldsPointsTimeSeries } from "./mcp-gefs-points-bundle-timeseries-tool.js";
import { handleGetGefsFieldsPoints } from "./mcp-gefs-points-bundle-tool.js";
import { handleGetGefsTransect } from "./mcp-gefs-transect-tool.js";
import { createMcpServer as createBaseMcpServer } from "./mcp-server.js";
import {
  gefsAreaSummaryQuerySchema,
  gefsAreaSummaryResultSchema,
} from "./schema/gefs-area-summary.js";
import {
  gefsBundleTimeSeriesQuerySchema,
  gefsBundleTimeSeriesResultSchema,
} from "./schema/gefs-bundle-timeseries.js";
import {
  gefsMemberBundleQuerySchema,
  gefsMemberBundleResultSchema,
} from "./schema/gefs-member-bundle.js";
import {
  gefsPointsBundleTimeSeriesQuerySchema,
  gefsPointsBundleTimeSeriesResultSchema,
} from "./schema/gefs-points-bundle-timeseries.js";
import {
  gefsPointsBundleQuerySchema,
  gefsPointsBundleResultSchema,
} from "./schema/gefs-points-bundle.js";
import { gefsTransectQuerySchema, gefsTransectResultSchema } from "./schema/gefs-transect.js";

/**
 * Extend the shared MCP server with GEFS model-native operations without
 * duplicating the existing registry. Both stdio and Streamable HTTP entrypoints
 * use this factory, so the public MCP tool catalog remains transport-identical.
 */
export function createMcpServer() {
  const server = createBaseMcpServer();
  const bundleService = new GefsMemberBundleService();
  const timeSeriesService = new GefsBundleTimeSeriesService({ bundleGetter: bundleService });
  const pointsService = new GefsPointsBundleService();
  const pointsTimeSeriesService = new GefsPointsBundleTimeSeriesService({ pointsGetter: pointsService });
  const transectService = new GefsTransectService({ pointsGetter: pointsService });
  const areaService = new GefsAreaSummaryService();

  server.registerTool("get_gefs_fields", {
    title: "Get mixed GEFS field distributions",
    description: "Fetch one mixed GEFS 0.5° pgrb2a selection at one point/time: multiple pressure variables/levels plus non-isobaric fields such as 2 m temperature/RH, 10 m wind, precipitation, PWAT, cloud cover, CAPE/CIN, or MSLP. WFG merges all raw dependencies into one selected GRIB slice and one wgrib2 decode per member, derives supported thermodynamics member-by-member, then summarizes across members. Accumulation/average intervals are explicit; wind direction uses circular aggregation. Member arrays are optional. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsMemberBundleQuerySchema,
    outputSchema: gefsMemberBundleResultSchema,
  }, async (query) => handleGetGefsFields(bundleService, query));

  server.registerTool("get_gefs_fields_timeseries", {
    title: "Get mixed GEFS field time series",
    description: "Track one mixed GEFS pressure/non-isobaric selection across native three-hour valid times from one fixed model cycle and member set. Each forecast step performs one mixed selected-message fetch/decode per member, preserving field-specific accumulation/average windows and member-first derived values. Compact distribution summaries are returned by default; includeMembers is guarded by maxMemberSamples to bound agent context. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsBundleTimeSeriesQuerySchema,
    outputSchema: gefsBundleTimeSeriesResultSchema,
  }, async (query) => handleGetGefsFieldsTimeSeries(timeSeriesService, query));

  server.registerTool("get_gefs_fields_points", {
    title: "Get mixed GEFS fields for multiple points",
    description: "Evaluate one mixed GEFS pressure/non-isobaric selection at up to 20 coordinates for one run and valid time. WFG fetches one selected-message file per member independent of point count, then samples each requested coordinate locally from those immutable files. Every point is summarized independently with the same member-first thermodynamics, field temporal semantics and circular wind-direction aggregation as get_gefs_fields. Local wgrib2 extraction still scales with members × points. Member payloads are optional and bounded by maxMemberSamples. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsPointsBundleQuerySchema,
    outputSchema: gefsPointsBundleResultSchema,
  }, async (query) => handleGetGefsFieldsPoints(pointsService, query));

  server.registerTool("get_gefs_fields_points_timeseries", {
    title: "Get mixed GEFS fields for multiple points over time",
    description: "Track one mixed GEFS pressure/non-isobaric selection across up to 20 coordinates and native three-hour valid times from one fixed model cycle and member set. Each step reuses one selected-message file per member across all requested points, so upstream fetches scale with steps × members rather than steps × members × points; local wgrib2 extraction remains point-oriented. maxPointSteps and maxMemberSamples bound matrix and opt-in member payload size. Field-specific accumulation/average intervals and circular wind-direction aggregation remain explicit. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsPointsBundleTimeSeriesQuerySchema,
    outputSchema: gefsPointsBundleTimeSeriesResultSchema,
  }, async (query) => handleGetGefsFieldsPointsTimeSeries(pointsTimeSeriesService, query));

  server.registerTool("get_gefs_transect", {
    title: "Get GEFS mixed-field transect",
    description: "Sample a great-circle cross-section from GEFS using up to 20 evenly spaced coordinates. The path geometry is shared with deterministic GFS, while each sample contains ensemble distributions for one mixed pressure/non-isobaric selection. WFG delegates the complete path to one multi-point bundle request, so each selected member file is reused across all transect coordinates; local wgrib2 extraction remains point-oriented. Member arrays are optional and bounded. Ensemble summaries are raw model-member evidence, not calibrated probability or uncertainty.",
    inputSchema: gefsTransectQuerySchema,
    outputSchema: gefsTransectResultSchema,
  }, async (query) => handleGetGefsTransect(transectService, query));

  server.registerTool("get_gefs_area_summary", {
    title: "Get GEFS member-first area statistics",
    description: "Summarize one raw GEFS pgrb2a pressure variable or non-isobaric field over a bounded box. WFG computes spatial mean/min/max, requested spatial percentiles and threshold fractions independently inside every member, then returns ensemble mean/spread/quantiles for those member-level statistics. This preserves the spatial and ensemble axes rather than flattening grid cells and members into one sample. Optional extrema locations are returned per member. Threshold-fraction distributions are raw member evidence, not calibrated probabilities.",
    inputSchema: gefsAreaSummaryQuerySchema,
    outputSchema: gefsAreaSummaryResultSchema,
  }, async (query) => handleGetGefsAreaSummary(areaService, query));

  return server;
}
