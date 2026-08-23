import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { BatchPointsService } from "./core/batch-points.js";
import { DiagnosticTimeSeriesService } from "./core/diagnostic-time-series.js";
import { GefsEnsembleProfileService } from "./core/gefs-ensemble-profile.js";
import { GefsEnsembleTimeSeriesService } from "./core/gefs-ensemble-timeseries.js";
import { GefsEnsembleService } from "./core/gefs-ensemble.js";
import { GefsLayerDiagnosticsService } from "./core/gefs-layer-diagnostics.js";
import { GefsProfileDiagnosticsService } from "./core/gefs-profile-diagnostics.js";
import { GfsGefsComparisonService } from "./core/gfs-gefs-comparison.js";
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
import {
  handleGetGefsEnsemble,
  handleGetGefsEnsembleProfile,
  handleGetGefsEnsembleTimeSeries,
  handleGetGefsLayerDiagnostics,
  handleGetGefsProfileDiagnostics,
} from "./mcp-gefs-tool.js";
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
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticsResultSchema,
} from "./schema/gefs-profile-diagnostics.js";
import {
  gfsGefsComparisonQuerySchema,
  gfsGefsComparisonResultSchema,
} from "./schema/gfs-gefs-comparison.js";
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
      instructions: "WFG exposes NOAA numerical weather models with explicit model/run/valid-time/vertical semantics. GFS and GEFS share model-independent profile and diagnostic kernels while preserving deterministic-vs-ensemble result semantics. Use get_gfs_catalog or search_gfs_catalog to discover the deterministic GFS 0.25° surface. GFS query tools support query-aware run='latest', latest_complete through f384, and explicit reproducible cycles. Use get_gefs_ensemble for one-time member distributions, get_gefs_ensemble_profile for multi-variable/multi-level vertical distributions, get_gefs_ensemble_timeseries for one-field native-cadence distributions, get_gefs_layer_diagnostics for per-member layer calculations, and get_gefs_profile_diagnostics for member-by-member freezing-level/inversion structures summarized across the ensemble. compare_gfs_to_gefs places deterministic GFS inside an aligned GEFS member distribution. GEFS member fractions, profile/diagnostic summaries, and GFS-vs-GEFS ranks are raw model/member evidence, not calibrated probabilities or uncertainty. WFG does not provide activity-specific interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const gefsEnsembleService = new GefsEnsembleService();
  const gefsEnsembleProfileService = new GefsEnsembleProfileService();
  const gefsEnsembleTimeSeriesService = new GefsEnsembleTimeSeriesService({ ensembleGetter: gefsEnsembleService });
  const gefsLayerDiagnosticsService = new GefsLayerDiagnosticsService({ profileGetter: gefsEnsembleProfileService });
  const gefsProfileDiagnosticsService = new GefsProfileDiagnosticsService({ profileGetter: gefsEnsembleProfileService });
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
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

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run",
    description: "Resolve the latest complete NOAA GFS 0.25° cycle published through f384. Query tools use run='latest' for query-aware newest-available selection instead.",
    inputSchema: z.object({}),
    outputSchema: latestGfsRunResultSchema,
  }, async () => handleGetLatestGfsRun(latestRunResolver));

  server.registerTool("get_gefs_ensemble", {
    title: "Get GEFS pressure-level ensemble",
    description: "Sample one raw NOAA GEFS 0.5° pgrb2a pressure-level variable at one point and native three-hour valid time across the control and selected perturbed members. Returns each normalized member value plus mean, population standard deviation, extrema, requested quantiles, and an optional >= threshold member fraction. The threshold fraction is raw ensemble membership, not a calibrated probability.",
    inputSchema: gefsEnsembleQuerySchema,
    outputSchema: gefsEnsembleResultSchema,
  }, async (query) => handleGetGefsEnsemble(gefsEnsembleService, query));

  server.registerTool("get_gefs_ensemble_profile", {
    title: "Get GEFS ensemble pressure profile",
    description: "Summarize multiple raw GEFS 0.5° pgrb2a pressure-level variables across multiple published pressure surfaces and selected members at one point/time. WFG fetches one multi-message slice per member and returns per variable/level mean, population spread, extrema, and quantiles. Member profiles are omitted by default; set includeMembers=true only when memberwise vertical trajectories are needed.",
    inputSchema: gefsEnsembleProfileQuerySchema,
    outputSchema: gefsEnsembleProfileResultSchema,
  }, async (query) => handleGetGefsEnsembleProfile(gefsEnsembleProfileService, query));

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
