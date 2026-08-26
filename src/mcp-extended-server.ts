import { GefsAreaSummaryService } from "./core/gefs-area-summary.js";
import { GefsBundleTimeSeriesService } from "./core/gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "./core/gefs-member-bundle.js";
import { GefsPointsBundleTimeSeriesService } from "./core/gefs-points-bundle-timeseries.js";
import { GefsPointsBundleService } from "./core/gefs-points-bundle.js";
import { GefsTransectService } from "./core/gefs-transect.js";
import { HistoricalIndexBackfillService } from "./core/history-backfill.js";
import { HistoricalDiagnosticTimeSeriesService } from "./core/history-diagnostic-timeseries.js";
import { HistoricalDiagnosticsService } from "./core/history-diagnostics.js";
import { HistoricalFieldsTimeSeriesService } from "./core/history-fields-timeseries.js";
import { HistoricalFieldsService } from "./core/history-fields.js";
import { HistoricalIndexService } from "./core/history-index.js";
import { HistoricalParcelTimeSeriesService } from "./core/history-parcel-timeseries.js";
import { HistoricalParcelService } from "./core/history-parcel.js";
import { HistoricalPointsService } from "./core/history-points.js";
import { HistoricalTimeSeriesService } from "./core/history-time-series.js";
import { HistoricalForecastVerificationService } from "./core/history-verification.js";
import { handleGetGefsAreaSummary } from "./mcp-gefs-area-tool.js";
import {
  handleGetGefsFields,
  handleGetGefsFieldsTimeSeries,
} from "./mcp-gefs-bundle-tool.js";
import { handleGetGefsFieldsPointsTimeSeries } from "./mcp-gefs-points-bundle-timeseries-tool.js";
import { handleGetGefsFieldsPoints } from "./mcp-gefs-points-bundle-tool.js";
import { handleGetGefsTransect } from "./mcp-gefs-transect-tool.js";
import {
  handleGetGfsHistoricalDiagnosticTimeSeries,
  handleGetGfsHistoricalLayerDiagnostics,
  handleGetGfsHistoricalProfileDiagnostics,
} from "./mcp-history-diagnostics-tool.js";
import {
  handleGetGfsHistoricalFields,
  handleGetGfsHistoricalFieldsTimeSeries,
} from "./mcp-history-fields-tool.js";
import {
  handleGetGfsHistoricalParcel,
  handleGetGfsHistoricalParcelTimeSeries,
} from "./mcp-history-parcel-tool.js";
import { handleGetGfsHistoricalPoints } from "./mcp-history-points-tool.js";
import {
  handleBackfillGfsHistoryIndex,
  handleFindGfsHistoricalAnalogs,
  handleGetGfsHistoricalTimeSeries,
  handleMaterializeGfsHistoryIndex,
  handleVerifyGfsHistoricalForecast,
} from "./mcp-history-tool.js";
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
import { historicalTimeSeriesQuerySchema } from "./schema/history.js";
import {
  historicalDiagnosticTimeSeriesQuerySchema,
  historicalDiagnosticTimeSeriesResultSchema,
} from "./schema/history-diagnostic-timeseries.js";
import {
  historicalLayerDiagnosticsQuerySchema,
  historicalLayerDiagnosticsResultSchema,
  historicalProfileDiagnosticsQuerySchema,
  historicalProfileDiagnosticsResultSchema,
} from "./schema/history-diagnostics.js";
import {
  historicalFieldsTimeSeriesQuerySchema,
  historicalFieldsTimeSeriesResultSchema,
} from "./schema/history-fields-timeseries.js";
import {
  historicalFieldsQuerySchema,
  historicalFieldsResultSchema,
} from "./schema/history-fields.js";
import {
  historicalPointsQuerySchema,
  historicalPointsResultSchema,
} from "./schema/history-points.js";
import {
  historicalParcelQuerySchema,
  historicalParcelResultSchema,
  historicalParcelTimeSeriesQuerySchema,
  historicalParcelTimeSeriesResultSchema,
} from "./schema/history-parcel.js";
import { historicalTimeSeriesResultSchema } from "./schema/history-result.js";
import {
  historicalAnalogQuerySchema,
  historicalAnalogResultSchema,
  historicalIndexBackfillQuerySchema,
  historicalIndexBackfillResultSchema,
  historicalIndexBuildQuerySchema,
  historicalIndexBuildResultSchema,
} from "./schema/history-index.js";
import { historicalForecastVerificationQuerySchema } from "./schema/history-verification.js";
import { historicalForecastVerificationResultSchema } from "./schema/history-verification-result.js";

/**
 * Extend the shared MCP server with model-native and archive operations without
 * duplicating the existing registry. Both stdio and Streamable HTTP entrypoints
 * use this factory, so the public MCP tool catalog remains transport-identical.
 */
export function createMcpServer() {
  const server = createBaseMcpServer();
  const historicalTimeSeriesService = new HistoricalTimeSeriesService();
  const historicalFieldsService = new HistoricalFieldsService();
  const historicalFieldsTimeSeriesService = new HistoricalFieldsTimeSeriesService({
    fieldsGetter: historicalFieldsService,
  });
  const historicalParcelService = new HistoricalParcelService({ fieldsGetter: historicalFieldsService });
  const historicalParcelTimeSeriesService = new HistoricalParcelTimeSeriesService({
    parcelGetter: historicalParcelService,
  });
  const historicalDiagnosticsService = new HistoricalDiagnosticsService();
  const historicalPointsService = new HistoricalPointsService({
    fieldsGetter: historicalFieldsService,
  });
  const historicalDiagnosticTimeSeriesService = new HistoricalDiagnosticTimeSeriesService({
    layerDiagnosticsGetter: historicalDiagnosticsService,
    profileDiagnosticsGetter: historicalDiagnosticsService,
    parcelDiagnosticsGetter: historicalParcelService,
  });
  const historicalIndexService = new HistoricalIndexService();
  const historicalBackfillService = new HistoricalIndexBackfillService();
  const historicalVerificationService = new HistoricalForecastVerificationService();
  const bundleService = new GefsMemberBundleService();
  const timeSeriesService = new GefsBundleTimeSeriesService({ bundleGetter: bundleService });
  const pointsService = new GefsPointsBundleService();
  const pointsTimeSeriesService = new GefsPointsBundleTimeSeriesService({ pointsGetter: pointsService });
  const transectService = new GefsTransectService({ pointsGetter: pointsService });
  const areaService = new GefsAreaSummaryService();

  server.registerTool("get_gfs_historical_timeseries", {
    title: "Get historical GFS analysis time series",
    description: "Fetch a bounded series of NOAA NCEI GFS Grid 4 0.5° historical analysis profiles at one point. Select any subset of the native 00/06/12/18 UTC cycles, for example only 12 UTC for sparse daily sampling. Requests are bounded by maxSteps and archive accesses are performed serially under WFG's NOAA courtesy limiter. This is GFS model analysis, not direct observations or a homogeneous climatological reanalysis.",
    inputSchema: historicalTimeSeriesQuerySchema,
    outputSchema: historicalTimeSeriesResultSchema,
  }, async (query) => handleGetGfsHistoricalTimeSeries(historicalTimeSeriesService, query));

  server.registerTool("get_gfs_historical_fields", {
    title: "Get historical GFS mixed fields",
    description: "Fetch archived GFS Grid 4 analysis fields using the same WFG field IDs as operational GFS where the historical product is genuinely comparable. Supports surface pressure/HGT/temperature, surface CAPE/CIN, 2 m thermodynamics, 10/80/100 m winds, 80/100 m temperatures where archived, 80 m pressure/specific humidity, and column PWAT/cloud water/RH/ozone. Optional pressure variables can be requested in the same operation. Historical fields are instantaneous analysis values; forecast accumulations such as total precipitation are deliberately excluded.",
    inputSchema: historicalFieldsQuerySchema,
    outputSchema: historicalFieldsResultSchema,
  }, async (query) => handleGetGfsHistoricalFields(historicalFieldsService, query));

  server.registerTool("get_gfs_historical_points", {
    title: "Get historical GFS fields for multiple points",
    description: "Evaluate one historical GFS Grid 4 analysis selection across up to 10 coordinates. Supports the historical pressure-variable and non-isobaric field subsets, preserving each requested coordinate, sampled 0.5° grid point, archive dataset path and cache status. NCEI access is composed as serial point queries under WFG's NOAA courtesy limiter; unlike operational AWS-backed multi-point queries, this does not claim shared-slice reuse.",
    inputSchema: historicalPointsQuerySchema,
    outputSchema: historicalPointsResultSchema,
  }, async (query) => handleGetGfsHistoricalPoints(historicalPointsService, query));

  server.registerTool("get_gfs_historical_fields_timeseries", {
    title: "Get historical GFS mixed-field time series",
    description: "Track the historical mixed pressure/non-isobaric selection across a bounded series of native 00/06/12/18 UTC GFS Grid 4 analysis cycles. Uses the same historical field subset and instantaneous semantics as get_gfs_historical_fields, with default maxSteps 8 and hard maximum 16. Archive reads are serial under WFG's NOAA courtesy limiter.",
    inputSchema: historicalFieldsTimeSeriesQuerySchema,
    outputSchema: historicalFieldsTimeSeriesResultSchema,
  }, async (query) => handleGetGfsHistoricalFieldsTimeSeries(historicalFieldsTimeSeriesService, query));

  server.registerTool("get_gfs_historical_parcel", {
    title: "Get historical GFS parcel diagnostics",
    description: "Lift an explicit surface-2m, mixed-layer-100hPa, or most-unstable-300hPa parcel through one archived GFS Grid 4 analysis and derive LCL/LFC/EL/CAPE/CIN with the same parcel engine as operational GFS. Historical pressure-level and 2 m moisture are reconstructed from stable analysis humidity inputs where needed. This is model-analysis diagnostics, not direct observations or homogeneous climatological reanalysis.",
    inputSchema: historicalParcelQuerySchema,
    outputSchema: historicalParcelResultSchema,
  }, async (query) => handleGetGfsHistoricalParcel(historicalParcelService, query));

  server.registerTool("get_gfs_historical_parcel_timeseries", {
    title: "Get historical GFS parcel time series",
    description: "Evaluate one explicit parcel definition across a bounded series of native 00/06/12/18 UTC GFS Grid 4 analysis cycles. Each step uses the same historical pressure/surface state and parcel engine as get_gfs_historical_parcel; default maxSteps is 8 and the hard maximum is 16. Archive reads remain serial under WFG's NOAA courtesy limiter.",
    inputSchema: historicalParcelTimeSeriesQuerySchema,
    outputSchema: historicalParcelTimeSeriesResultSchema,
  }, async (query) => handleGetGfsHistoricalParcelTimeSeries(historicalParcelTimeSeriesService, query));

  server.registerTool("get_gfs_historical_layer_diagnostics", {
    title: "Get historical GFS layer diagnostics",
    description: "Derive the same pressure-layer lapse-rate, vector-shear and potential-temperature-gradient diagnostics used by operational GFS/GEFS from one archived GFS Grid 4 analysis. The source is model analysis, not direct observations or homogeneous climatological reanalysis.",
    inputSchema: historicalLayerDiagnosticsQuerySchema,
    outputSchema: historicalLayerDiagnosticsResultSchema,
  }, async (query) => handleGetGfsHistoricalLayerDiagnostics(historicalDiagnosticsService, query));

  server.registerTool("get_gfs_historical_diagnostic_timeseries", {
    title: "Get historical GFS diagnostic time series",
    description: "Evaluate one layer, whole-profile, or parcel diagnostic selection across a bounded series of native 00/06/12/18 UTC GFS Grid 4 analysis cycles. This is the historical-analysis counterpart of the operational diagnostic time-series operation: analysisTime replaces forecast run/lead semantics, archive reads remain serial under WFG's NOAA courtesy limiter, and parcel paths are compacted per step.",
    inputSchema: historicalDiagnosticTimeSeriesQuerySchema,
    outputSchema: historicalDiagnosticTimeSeriesResultSchema,
  }, async (query) => handleGetGfsHistoricalDiagnosticTimeSeries(historicalDiagnosticTimeSeriesService, query));

  server.registerTool("get_gfs_historical_profile_diagnostics", {
    title: "Get historical GFS profile diagnostics",
    description: "Derive the same freezing-level-crossing and temperature-inversion diagnostics used by operational GFS/GEFS from one archived GFS Grid 4 pressure profile. The source is model analysis, not direct observations or homogeneous climatological reanalysis.",
    inputSchema: historicalProfileDiagnosticsQuerySchema,
    outputSchema: historicalProfileDiagnosticsResultSchema,
  }, async (query) => handleGetGfsHistoricalProfileDiagnostics(historicalDiagnosticsService, query));

  server.registerTool("materialize_gfs_history_index", {
    title: "Materialize GFS history for local analog search",
    description: "Fetch a bounded historical NOAA NCEI GFS Grid 4 analysis range and append normalized profiles to WFG's local JSONL history index. The same maxSteps guard as historical time series applies, so one call cannot trigger an unbounded archive scan. Repeated materialization of an existing semantic record is deduplicated. This mutates only the local WFG history index; it does not modify upstream data.",
    inputSchema: historicalIndexBuildQuerySchema,
    outputSchema: historicalIndexBuildResultSchema,
  }, async (query) => handleMaterializeGfsHistoryIndex(historicalIndexService, query));

  server.registerTool("backfill_gfs_history_index", {
    title: "Backfill a large GFS analysis history range",
    description: "Resumably populate WFG's local GFS Grid 4 analysis index across a large historical range. Existing profiles are skipped before any fetch. Each invocation has an explicit maxFetches budget (default 16, max 256), returns the next missing cycle, and may run oldest-first or newest-first, dry-run, or continue across isolated errors. Archive reads remain serial under WFG's NOAA courtesy limiter. This deliberately uses exact NCEI GFS analyses; NOAA ARL's quarter-degree archive is short-term forecast data and is not substituted for analysis history.",
    inputSchema: historicalIndexBackfillQuerySchema,
    outputSchema: historicalIndexBackfillResultSchema,
  }, async (query) => handleBackfillGfsHistoryIndex(historicalBackfillService, query));

  server.registerTool("find_gfs_historical_analogs", {
    title: "Find historical GFS analog analyses",
    description: "Find locally materialized GFS Grid 4 analysis profiles most similar to one target analysis at the same sampled 0.5° grid point and exact variable/pressure selection. Similarity uses standardized Euclidean distance; vector wind is represented by U/V components so direction wrap-around is not treated as a large discontinuity. Candidate search is local. If fetchTargetIfMissing is true, WFG may fetch only the single target analysis when it is absent from the index. The score is model-state similarity, not climatological rarity or impact-specific similarity.",
    inputSchema: historicalAnalogQuerySchema,
    outputSchema: historicalAnalogResultSchema,
  }, async (query) => handleFindGfsHistoricalAnalogs(historicalIndexService, query));

  server.registerTool("verify_gfs_historical_forecast", {
    title: "Verify archived GFS forecast",
    description: "Compare one archived NOAA NCEI GFS Grid 4 0.5° forecast with the later GFS analysis at the same valid time and grid point. Provide a native 00/06/12/18 UTC valid time and one leadHours value (0-192, multiple of 6); WFG derives the forecast run, fetches forecast then analysis serially under NOAA courtesy pacing, and reports analysis-minus-forecast changes with circular wind-direction deltas. Verification is against model analysis, not direct observations, and older forecast files may require NCEI HAS when they are not available online through THREDDS.",
    inputSchema: historicalForecastVerificationQuerySchema,
    outputSchema: historicalForecastVerificationResultSchema,
  }, async (query) => handleVerifyGfsHistoricalForecast(historicalVerificationService, query));

  server.registerTool("get_gefs_fields", {
    title: "Get mixed GEFS field distributions",
    description: "Fetch one mixed GEFS 0.5° pgrb2a selection at one point/time: multiple pressure variables/levels plus non-isobaric fields such as 2 m temperature/RH, 10 m wind, precipitation, PWAT, cloud cover, CAPE/CIN, or MSLP. WFG merges all raw dependencies into one selected GRIB slice and one wgrib2 decode per member, derives supported thermodynamics member-by-member, then aggregates across members. Accumulation/average intervals are explicit; wind direction uses circular aggregation. Member arrays are optional. Ensemble summaries are raw member evidence, not calibrated probability or uncertainty.",
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
