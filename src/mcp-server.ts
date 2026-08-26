import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { BatchPointsService } from "./core/batch-points.js";
import { DiagnosticTimeSeriesService } from "./core/diagnostic-time-series.js";
import { GefsBatchPointsService } from "./core/gefs-batch-points.js";
import { GefsDiagnosticTimeSeriesService } from "./core/gefs-diagnostic-timeseries.js";
import { GefsEnsembleProfileService } from "./core/gefs-ensemble-profile.js";
import { GefsEnsembleTimeSeriesService } from "./core/gefs-ensemble-timeseries.js";
import { GefsEnsembleService } from "./core/gefs-ensemble.js";
import { GefsLayerDiagnosticsService } from "./core/gefs-layer-diagnostics.js";
import { GefsParcelDiagnosticsService } from "./core/gefs-parcel-diagnostics.js";
import { GefsPointsTimeSeriesService } from "./core/gefs-points-timeseries.js";
import { GefsProfileDiagnosticsService } from "./core/gefs-profile-diagnostics.js";
import { GefsRunComparisonService } from "./core/gefs-run-comparison.js";
import { GfsGefsComparisonService } from "./core/gfs-gefs-comparison.js";
import { HistoricalProfileService } from "./core/history.js";
import { LayerDiagnosticsService } from "./core/layer-diagnostics.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ParcelDiagnosticsService } from "./core/parcel-diagnostics.js";
import { PointsTimeSeriesService } from "./core/points-time-series.js";
import { ProfileDiagnosticsService } from "./core/profile-diagnostics.js";
import { ProfileService } from "./core/profile.js";
import { RunComparisonService } from "./core/run-comparison.js";
import { TimeSeriesService } from "./core/time-series.js";
import { TransectService } from "./core/transect.js";
import { handleGetGfsAreaSummary } from "./mcp-area-tool.js";
import { handleGetGefsCatalog, handleSearchGefsCatalog } from "./mcp-gefs-catalog-tool.js";
import { handleGetGefsPointsTimeSeries } from "./mcp-gefs-points-timeseries-tool.js";
import {
  handleCompareGefsRuns,
  handleGetGefsDiagnosticTimeSeries,
  handleGetGefsEnsemble,
  handleGetGefsEnsembleProfile,
  handleGetGefsEnsembleTimeSeries,
  handleGetGefsLayerDiagnostics,
  handleGetGefsParcelDiagnostics,
  handleGetGefsPoints,
  handleGetGefsProfileDiagnostics,
} from "./mcp-gefs-tool.js";
import { handleGetGfsHistoricalProfile } from "./mcp-history-tool.js";
import { handleCompareGfsToGefs } from "./mcp-model-comparison-tool.js";
import {
  handleCompareGfsRuns,
  handleGetGfsCatalog,
  handleGetGfsDiagnosticTimeSeries,
  handleGetGfsLayerDiagnostics,
  handleGetGfsParcelDiagnostics,
  handleGetGfsPoints,
  handleGetGfsPointsTimeSeries,
  handleGetGfsProfile,
  handleGetGfsProfileDiagnostics,
  handleGetGfsTimeSeries,
  handleGetLatestGfsRun,
  handleSearchGfsCatalog,
} from "./mcp-tool.js";
import { handleGetGfsTransect } from "./mcp-transect-tool.js";
import { areaSummaryQuerySchema } from "./schema/area-summary.js";
import { areaSummaryResultSchema } from "./schema/area-summary-result.js";
import { catalogSearchQuerySchema, catalogSearchResultSchema } from "./schema/catalog-search.js";
import { diagnosticTimeSeriesQuerySchema } from "./schema/diagnostic-time-series.js";
import { diagnosticTimeSeriesResultSchema } from "./schema/diagnostic-time-series-result.js";
import {
  gefsBatchPointsQuerySchema,
  gefsBatchPointsResultSchema,
} from "./schema/gefs-batch-points.js";
import {
  gefsDiagnosticTimeSeriesQuerySchema,
  gefsDiagnosticTimeSeriesResultSchema,
} from "./schema/gefs-diagnostic-timeseries.js";
import {
  gefsEnsembleProfileQuerySchema,
  gefsEnsembleProfileResultSchema,
} from "./schema/gefs-ensemble-profile.js";
import {
  gefsEnsembleTimeSeriesQuerySchema,
  gefsEnsembleTimeSeriesResultSchema,
} from "./schema/gefs-ensemble-timeseries.js";
import { gefsEnsembleQuerySchema, gefsEnsembleResultSchema } from "./schema/gefs-ensemble.js";
import {
  gefsLayerDiagnosticsQuerySchema,
  gefsLayerDiagnosticsResultSchema,
} from "./schema/gefs-layer-diagnostics.js";
import {
  gefsParcelDiagnosticsQuerySchema,
  gefsParcelDiagnosticsResultSchema,
} from "./schema/gefs-parcel-diagnostics.js";
import {
  gefsPointsTimeSeriesQuerySchema,
  gefsPointsTimeSeriesResultSchema,
} from "./schema/gefs-points-timeseries.js";
import {
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticsResultSchema,
} from "./schema/gefs-profile-diagnostics.js";
import {
  gefsRunComparisonQuerySchema,
  gefsRunComparisonResultSchema,
} from "./schema/gefs-run-comparison.js";
import {
  gfsGefsComparisonQuerySchema,
  gfsGefsComparisonResultSchema,
} from "./schema/gfs-gefs-comparison.js";
import { historicalProfileQuerySchema } from "./schema/history.js";
import { historicalProfileResultSchema } from "./schema/history-result.js";
import {
  batchPointsQuerySchema,
  layerDiagnosticsQuerySchema,
  parcelDiagnosticsQuerySchema,
  pointsTimeSeriesQuerySchema,
  profileDiagnosticsQuerySchema,
  profileQuerySchema,
  runComparisonQuerySchema,
  timeSeriesQuerySchema,
} from "./schema/query.js";
import {
  batchPointsResultSchema,
  layerDiagnosticsResultSchema,
  latestGfsRunResultSchema,
  parcelDiagnosticsResultSchema,
  pointsTimeSeriesResultSchema,
  profileDiagnosticsResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "./schema/result.js";
import { runComparisonResultSchema } from "./schema/run-comparison-result.js";
import { transectResultSchema } from "./schema/transect-result.js";
import { transectQuerySchema } from "./schema/transect.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions: "WFG exposes NOAA numerical weather models with explicit model/run/valid-time/vertical semantics. GFS and GEFS share model-independent profile and diagnostic kernels while preserving deterministic-vs-ensemble result semantics. Use get_gfs_catalog/search_gfs_catalog for deterministic GFS discovery and get_gefs_catalog/search_gefs_catalog for the ensemble GEFS pgrb2a surface, including member-first derived profile and parcel capabilities. GFS query tools support query-aware run='latest', latest_complete through f384, and explicit reproducible cycles. get_gfs_historical_profile accesses the separate NOAA NCEI GFS Grid 4 0.5° analysis archive for historical model state; it is not direct observation data or a homogeneous climatological reanalysis. Use get_gefs_ensemble for one-time member distributions, get_gefs_ensemble_profile for multi-variable/multi-level vertical distributions, get_gefs_points for one raw field summarized across members at multiple locations using one selected field slice per member, get_gefs_ensemble_timeseries for one-field native-cadence distributions at one location, get_gefs_points_timeseries for the same raw-field distributions across multiple locations and native three-hour steps from one fixed cycle, get_gefs_layer_diagnostics, get_gefs_profile_diagnostics, and get_gefs_parcel_diagnostics for member-first single-time diagnostics, get_gefs_diagnostic_timeseries for compact layer/profile/parcel diagnostic distributions across native three-hour steps from one fixed cycle, and compare_gefs_runs for distribution evolution across consecutive initialization cycles without treating member IDs as trajectories. compare_gfs_to_gefs places deterministic GFS inside an aligned GEFS member distribution. GEFS member fractions, profile/point/diagnostic summaries, cycle shifts, and GFS-vs-GEFS ranks are raw model/member evidence, not calibrated probabilities or uncertainty. WFG does not provide activity-specific interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const gefsEnsembleService = new GefsEnsembleService();
  const gefsEnsembleProfileService = new GefsEnsembleProfileService();
  const gefsBatchPointsService = new GefsBatchPointsService();
  const gefsPointsTimeSeriesService = new GefsPointsTimeSeriesService({ batchPointsGetter: gefsBatchPointsService });
  const gefsEnsembleTimeSeriesService = new GefsEnsembleTimeSeriesService({ ensembleGetter: gefsEnsembleService });
  const gefsLayerDiagnosticsService = new GefsLayerDiagnosticsService({ profileGetter: gefsEnsembleProfileService });
  const gefsProfileDiagnosticsService = new GefsProfileDiagnosticsService({ profileGetter: gefsEnsembleProfileService });
  const gefsParcelDiagnosticsService = new GefsParcelDiagnosticsService();
  const gefsDiagnosticTimeSeriesService = new GefsDiagnosticTimeSeriesService({
    layerDiagnosticsGetter: gefsLayerDiagnosticsService,
    profileDiagnosticsGetter: gefsProfileDiagnosticsService,
    parcelDiagnosticsGetter: gefsParcelDiagnosticsService,
  });
  const gefsRunComparisonService = new GefsRunComparisonService({ ensembleGetter: gefsEnsembleService });
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const historyService = new HistoricalProfileService();
  const gfsGefsComparisonService = new GfsGefsComparisonService({
    profileGetter: profileService,
    ensembleGetter: gefsEnsembleService,
  });
  const layerDiagnosticsService = new LayerDiagnosticsService({ profileGetter: profileService });
  const profileDiagnosticsService = new ProfileDiagnosticsService({ profileGetter: profileService });
  const parcelDiagnosticsService = new ParcelDiagnosticsService({ profileGetter: profileService });
  const diagnosticTimeSeriesService = new DiagnosticTimeSeriesService({
    layerDiagnosticsGetter: layerDiagnosticsService,
    profileDiagnosticsGetter: profileDiagnosticsService,
    parcelDiagnosticsGetter: parcelDiagnosticsService,
    latestRunProvider: latestRunResolver,
  });
  const batchPointsService = new BatchPointsService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
  const transectService = new TransectService({ batchPointsGetter: batchPointsService });
  const timeSeriesService = new TimeSeriesService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
  const pointsTimeSeriesService = new PointsTimeSeriesService({
    latestRunProvider: latestRunResolver,
    batchPointsGetter: batchPointsService,
  });
  const runComparisonService = new RunComparisonService({
    latestRunProvider: latestRunResolver,
    profileGetter: profileService,
  });
  const areaSummaryService = new AreaSummaryService({ latestRunProvider: latestRunResolver });

  server.registerTool("get_gfs_catalog", {
    title: "Get supported GFS field catalog",
    description: "List the complete pressure-level variable, deterministic layer/profile/parcel diagnostic, and non-isobaric field catalog with canonical outputs, dependencies, and units. Use search_gfs_catalog when only a compact subset is needed.",
    inputSchema: z.object({}),
  }, async () => handleGetGfsCatalog());

  server.registerTool("search_gfs_catalog", {
    title: "Search supported GFS fields and diagnostics",
    description: "Return compact ranked catalog matches across pressure variables, non-isobaric fields, layer/profile diagnostics, and parcel definitions. Search natural text, IDs, dependencies, output names/units, GFS codes, and vertical/temporal semantics; optionally filter sections, raw/derived classification, and instantaneous/accumulation/average fields.",
    inputSchema: catalogSearchQuerySchema,
    outputSchema: catalogSearchResultSchema,
  }, async (query) => handleSearchGfsCatalog(query));

  server.registerTool("get_gefs_catalog", {
    title: "Get supported GEFS pgrb2a catalog",
    description: "List the supported GEFS 0.5° pgrb2a pressure-profile variables, member-first derived thermodynamics, layer/profile/parcel diagnostics, and non-isobaric fields with model-specific availability and temporal/vertical semantics. Use search_gefs_catalog for compact discovery.",
    inputSchema: z.object({}),
  }, async () => handleGetGefsCatalog());

  server.registerTool("search_gefs_catalog", {
    title: "Search supported GEFS fields and diagnostics",
    description: "Return compact ranked GEFS catalog matches across raw and derived profile variables, pgrb2a fields, layer/profile diagnostics, and parcel definitions. Search IDs, descriptions, dependencies, outputs/units, GRIB codes, and vertical/temporal semantics; optionally filter section, raw/derived classification, and temporal semantics.",
    inputSchema: catalogSearchQuerySchema,
    outputSchema: catalogSearchResultSchema,
  }, async (query) => handleSearchGefsCatalog(query));

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run",
    description: "Resolve the latest complete NOAA GFS 0.25° cycle published through f384. Query tools use run='latest' for query-aware newest-available selection instead.",
    inputSchema: z.object({}),
    outputSchema: latestGfsRunResultSchema,
  }, async () => handleGetLatestGfsRun(latestRunResolver));

  server.registerTool("get_gfs_historical_profile", {
    title: "Get historical GFS analysis profile",
    description: "Fetch one NOAA NCEI GFS Grid 4 0.5° historical analysis cycle at one point and selected pressure levels. Supports a stable long-record subset of pressure variables plus deterministic wind, dew-point, and potential-temperature derivations. The online analysis archive begins in 2007. This is GFS model analysis, not direct observations or a homogeneous climatological reanalysis.",
    inputSchema: historicalProfileQuerySchema,
    outputSchema: historicalProfileResultSchema,
  }, async (query) => handleGetGfsHistoricalProfile(historyService, query));

  server.registerTool("get_gefs_ensemble", {
    title: "Get GEFS pressure-level ensemble",
    description: "Sample one raw NOAA GEFS 0.5° pgrb2a pressure-level or non-isobaric field at one point and native three-hour valid time across the control and selected perturbed members. Returns each normalized member value plus distribution summaries and optional raw threshold fraction. The threshold fraction is raw ensemble membership, not a calibrated probability.",
    inputSchema: gefsEnsembleQuerySchema,
    outputSchema: gefsEnsembleResultSchema,
  }, async (query) => handleGetGefsEnsemble(gefsEnsembleService, query));

  server.registerTool("get_gefs_ensemble_profile", {
    title: "Get GEFS ensemble pressure profile",
    description: "Summarize multiple GEFS 0.5° pgrb2a pressure-level variables across multiple published pressure surfaces and selected members at one point/time. Raw variables plus member-first dew point and potential-temperature derivations are supported. WFG fetches one dependency slice per member and returns per variable/level mean, population spread, extrema, and quantiles. Member profiles are omitted by default; set includeMembers=true only when memberwise vertical trajectories are needed.",
    inputSchema: gefsEnsembleProfileQuerySchema,
    outputSchema: gefsEnsembleProfileResultSchema,
  }, async (query) => handleGetGefsEnsembleProfile(gefsEnsembleProfileService, query));

  server.registerTool("get_gefs_points", {
    title: "Get GEFS distributions for multiple points",
    description: "Sample one raw GEFS 0.5° pressure-level field at up to 20 locations from one fixed run and member selection. WFG fetches each selected member's field slice once, then samples all requested coordinates locally, so upstream field fetches scale with members rather than points × members. Returns a distribution summary per point; member values are omitted unless includeMembers=true. Threshold fractions are raw member fractions, not calibrated probabilities.",
    inputSchema: gefsBatchPointsQuerySchema,
    outputSchema: gefsBatchPointsResultSchema,
  }, async (query) => handleGetGefsPoints(gefsBatchPointsService, query));

  server.registerTool("get_gefs_points_timeseries", {
    title: "Get GEFS time series for multiple points",
    description: "Track one raw GEFS 0.5° pgrb2a pressure-level field across up to 20 locations and native three-hour valid times from one fixed model cycle and member set. For each forecast step WFG fetches one selected field slice per member, then samples every requested coordinate locally, so upstream fetches scale with steps × members rather than steps × members × points. Returns compact distribution summaries per point-step by default; includeMembers exposes raw member values. maxSteps and maxSamples bound response size. Threshold fractions are raw member fractions, not calibrated probabilities.",
    inputSchema: gefsPointsTimeSeriesQuerySchema,
    outputSchema: gefsPointsTimeSeriesResultSchema,
  }, async (query) => handleGetGefsPointsTimeSeries(gefsPointsTimeSeriesService, query));

  server.registerTool("get_gefs_ensemble_timeseries", {
    title: "Get GEFS ensemble time series",
    description: "Track one raw GEFS 0.5° pgrb2a pressure-level variable across native three-hour valid times from one fixed model cycle and member selection. Returns compact per-step distribution summaries by default; set includeMembers=true only when individual member trajectories are needed. Optional threshold fractions are raw member fractions, not calibrated probabilities.",
    inputSchema: gefsEnsembleTimeSeriesQuerySchema,
    outputSchema: gefsEnsembleTimeSeriesResultSchema,
  }, async (query) => handleGetGefsEnsembleTimeSeries(gefsEnsembleTimeSeriesService, query));

  server.registerTool("get_gefs_layer_diagnostics", {
    title: "Get GEFS pressure-layer diagnostic distributions",
    description: "Apply the same layer meteorology used by deterministic GFS to every selected GEFS member, then summarize each diagnostic output across members. Supports environmental lapse rate, vector wind shear, and potential-temperature gradient. Layer depth is member-specific and is summarized separately. Memberwise inputs/results are omitted unless includeMembers=true. Distribution summaries are raw ensemble evidence, not calibrated uncertainty.",
    inputSchema: gefsLayerDiagnosticsQuerySchema,
    outputSchema: gefsLayerDiagnosticsResultSchema,
  }, async (query) => handleGetGefsLayerDiagnostics(gefsLayerDiagnosticsService, query));

  server.registerTool("get_gefs_profile_diagnostics", {
    title: "Get GEFS whole-profile diagnostic distributions",
    description: "Apply the same sampled-profile meteorology used by deterministic GFS independently to every selected GEFS member. Supports freezing-level crossings and sampled temperature-inversion layers. Returns raw member event fractions/count distributions plus conditional structural distributions only where the structure exists; complete member profiles/structures are omitted unless includeMembers=true. Fractions are raw ensemble evidence, not calibrated probabilities.",
    inputSchema: gefsProfileDiagnosticsQuerySchema,
    outputSchema: gefsProfileDiagnosticsResultSchema,
  }, async (query) => handleGetGefsProfileDiagnostics(gefsProfileDiagnosticsService, query));

  server.registerTool("get_gefs_parcel_diagnostics", {
    title: "Get GEFS parcel diagnostic distributions",
    description: "Lift the same explicit surface, 100 hPa mixed-layer, or most-unstable parcel independently through every selected GEFS member sounding. Pressure-level and 2 m specific humidity are derived from pgrb2a temperature/RH/pressure per member; static surface geopotential height comes from the same cycle's cached f000 orography. Returns CAPE/CIN and parcel-start/LCL distributions plus raw-member LFC/EL event fractions. Complete member soundings and parcel paths are omitted unless includeMembers=true. Ensemble fractions are not calibrated probabilities.",
    inputSchema: gefsParcelDiagnosticsQuerySchema,
    outputSchema: gefsParcelDiagnosticsResultSchema,
  }, async (query) => handleGetGefsParcelDiagnostics(gefsParcelDiagnosticsService, query));

  server.registerTool("get_gefs_diagnostic_timeseries", {
    title: "Get GEFS diagnostic time series",
    description: "Evaluate one fixed GEFS layer, whole-profile, or parcel diagnostic selection across native three-hour valid times from one model cycle and member set. Every step reuses the existing member-first single-time diagnostic services and returns compact ensemble summaries only; use the single-time tools to drill into member structures. Raw member fractions/spread are not calibrated probabilities or uncertainty.",
    inputSchema: gefsDiagnosticTimeSeriesQuerySchema,
    outputSchema: gefsDiagnosticTimeSeriesResultSchema,
  }, async (query) => handleGetGefsDiagnosticTimeSeries(gefsDiagnosticTimeSeriesService, query));

  server.registerTool("compare_gefs_runs", {
    title: "Compare consecutive GEFS model runs",
    description: "Compare the same raw GEFS 0.5° pressure-level distribution across 2-6 consecutive six-hour initialization cycles at one point/valid time. Each cycle is summarized independently for the same member set, then WFG reports newer-minus-older changes in mean, population spread, extrema, quantiles, and optional threshold member fraction. Perturbation member IDs are not treated as trajectories across cycles.",
    inputSchema: gefsRunComparisonQuerySchema,
    outputSchema: gefsRunComparisonResultSchema,
  }, async (query) => handleCompareGefsRuns(gefsRunComparisonService, query));

  server.registerTool("compare_gfs_to_gefs", {
    title: "Compare deterministic GFS to GEFS",
    description: "Place one deterministic GFS 0.25° raw pressure-level value inside the GEFS 0.5° member distribution from the same initialization cycle and valid time. Returns model-specific sampled grid points, deterministic-minus-ensemble-mean, standardized difference, empirical member rank fractions, and whether deterministic GFS lies outside the requested GEFS member range. These are raw model-distribution diagnostics, not calibrated uncertainty.",
    inputSchema: gfsGefsComparisonQuerySchema,
    outputSchema: gfsGefsComparisonResultSchema,
  }, async (query) => handleCompareGfsToGefs(gfsGefsComparisonService, query));

  server.registerTool("get_gfs_profile", {
    title: "Get GFS point fields",
    description: "Return supported NOAA GFS 0.25° pressure levels and/or non-isobaric fields for one point and valid time. Pressure variables include deterministic per-level thermodynamic derivations.",
    inputSchema: profileQuerySchema,
    outputSchema: profileResultSchema,
  }, async (query) => handleGetGfsProfile(profileService, query));

  server.registerTool("get_gfs_layer_diagnostics", {
    title: "Get GFS pressure-layer diagnostics",
    description: "Derive deterministic diagnostics across two published GFS pressure surfaces at one point/time. Supports environmental temperature lapse rate, vector wind shear, and potential-temperature gradient, and returns the raw endpoint values used by the derivations.",
    inputSchema: layerDiagnosticsQuerySchema,
    outputSchema: layerDiagnosticsResultSchema,
  }, async (query) => handleGetGfsLayerDiagnostics(layerDiagnosticsService, query));

  server.registerTool("get_gfs_profile_diagnostics", {
    title: "Get GFS whole-profile diagnostics",
    description: "Derive deterministic structure diagnostics over an explicit set of published pressure levels at one point/time. Supports all 0 degC crossings and sampled temperature-inversion layers. Returns the raw sampled profile used by the derivations; vertical resolution is determined by the pressure levels supplied by the caller.",
    inputSchema: profileDiagnosticsQuerySchema,
    outputSchema: profileDiagnosticsResultSchema,
  }, async (query) => handleGetGfsProfileDiagnostics(profileDiagnosticsService, query));

  server.registerTool("get_gfs_parcel_diagnostics", {
    title: "Get GFS parcel diagnostics",
    description: "Lift an explicitly defined parcel through an explicit GFS pressure profile and return parcel start, Bolton LCL, pseudo-adiabatic parcel path, first LFC/EL, CAPE and CIN. Parcel definitions are surface_2m, mixed_layer_100hpa, and most_unstable_300hpa. CAPE/CIN are derived from virtual-temperature buoyancy; the sampled pressure levels supplied by the caller control environmental resolution.",
    inputSchema: parcelDiagnosticsQuerySchema,
    outputSchema: parcelDiagnosticsResultSchema,
  }, async (query) => handleGetGfsParcelDiagnostics(parcelDiagnosticsService, query));

  server.registerTool("get_gfs_diagnostic_timeseries", {
    title: "Get GFS diagnostic time series",
    description: "Evaluate one deterministic layer, whole-profile, or parcel diagnostic selection at every native GFS output inside a valid-time range. One query resolves one model run for the whole range and preserves explicit pressure sampling. S3 is the default multi-time source. Parcel steps return compact start/LCL/LFC/EL/CAPE/CIN state without repeating the full parcel path at every forecast step.",
    inputSchema: diagnosticTimeSeriesQuerySchema,
    outputSchema: diagnosticTimeSeriesResultSchema,
  }, async (query) => handleGetGfsDiagnosticTimeSeries(diagnosticTimeSeriesService, query));

  server.registerTool("get_gfs_points", {
    title: "Get GFS fields for multiple points",
    description: "Return the same supported GFS field selection for up to 50 points at one valid time. Uses NOAA AWS byte ranges so the selected GRIB messages are fetched once and sampled at every requested point.",
    inputSchema: batchPointsQuerySchema,
    outputSchema: batchPointsResultSchema,
  }, async (query) => handleGetGfsPoints(batchPointsService, query));

  server.registerTool("get_gfs_transect", {
    title: "Get GFS pressure-level transect",
    description: "Return an explicit pressure-level cross-section between two coordinates at one valid time. WFG generates 2-50 evenly spaced great-circle samples, resolves one model cycle, fetches one shared NOAA AWS S3 selected-message slice, and returns along-track distance plus the same normalized pressure-level values used by point/batch queries.",
    inputSchema: transectQuerySchema,
    outputSchema: transectResultSchema,
  }, async (query) => handleGetGfsTransect(transectService, query));

  server.registerTool("get_gfs_timeseries", {
    title: "Get GFS point time series",
    description: "Return native GFS outputs inside a valid-time range for one point, including pressure-level and/or non-isobaric fields with explicit vertical and temporal semantics.",
    inputSchema: timeSeriesQuerySchema,
    outputSchema: timeSeriesResultSchema,
  }, async (query) => handleGetGfsTimeSeries(timeSeriesService, query));

  server.registerTool("get_gfs_points_timeseries", {
    title: "Get GFS time series for multiple points",
    description: "Return one atmospheric selection for up to 20 points across native GFS outputs in a valid-time range. Resolves one model cycle, fetches one shared NOAA AWS S3 GRIB slice per forecast step, and samples all requested points from that slice. maxSteps and maxSamples bound response size.",
    inputSchema: pointsTimeSeriesQuerySchema,
    outputSchema: pointsTimeSeriesResultSchema,
  }, async (query) => handleGetGfsPointsTimeSeries(pointsTimeSeriesService, query));

  server.registerTool("compare_gfs_runs", {
    title: "Compare consecutive GFS model runs",
    description: "Compare the same point, valid time, and atmospheric selection across 2-6 consecutive six-hour GFS cycles. Returns raw snapshots plus deterministic newer-minus-older deltas. Wind direction uses shortest signed angular change. Accumulation/average fields are only delta-comparable when their absolute time windows match.",
    inputSchema: runComparisonQuerySchema,
    outputSchema: runComparisonResultSchema,
  }, async (query) => handleCompareGfsRuns(runComparisonService, query));

  server.registerTool("summarize_gfs_area", {
    title: "Summarize GFS field over an area",
    description: "Return bounded-area min, max, and unweighted grid-point mean for either one raw GFS pressure-level variable at one pressure surface or one raw non-isobaric field. Optionally return percentiles, fractions of defined grid cells above/below normalized-unit thresholds, and representative min/max grid coordinates with tie counts. Rich statistics are computed locally from the bounded NOMADS subset; the raw grid is never returned.",
    inputSchema: areaSummaryQuerySchema,
    outputSchema: areaSummaryResultSchema,
  }, async (query) => handleGetGfsAreaSummary(areaSummaryService, query));

  return server;
}
