import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { AreaSummaryService } from "./core/area-summary.js";
import { BatchPointsService } from "./core/batch-points.js";
import { LayerDiagnosticsService } from "./core/layer-diagnostics.js";
import { LatestRunResolver } from "./core/latest-run.js";
import { ParcelDiagnosticsService } from "./core/parcel-diagnostics.js";
import { PointsTimeSeriesService } from "./core/points-time-series.js";
import { ProfileDiagnosticsService } from "./core/profile-diagnostics.js";
import { ProfileService } from "./core/profile.js";
import { RunComparisonService } from "./core/run-comparison.js";
import { TimeSeriesService } from "./core/time-series.js";
import {
  handleCompareGfsRuns,
  handleGetGfsAreaSummary,
  handleGetGfsCatalog,
  handleGetGfsLayerDiagnostics,
  handleGetGfsParcelDiagnostics,
  handleGetGfsPoints,
  handleGetGfsPointsTimeSeries,
  handleGetGfsProfile,
  handleGetGfsProfileDiagnostics,
  handleGetGfsTimeSeries,
  handleGetLatestGfsRun,
} from "./mcp-tool.js";
import {
  areaSummaryQuerySchema,
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
  areaSummaryResultSchema,
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

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather-for-grown-ups", version: "0.1.0" },
    {
      instructions: "Use get_gfs_catalog to discover pressure-level variables, deterministic pressure-layer, whole-profile, and parcel diagnostics, and non-isobaric GFS fields. For profile, diagnostics, batched-point, time-series, multi-point time-series, run-comparison, and area tools, run='latest' selects the newest GFS cycle whose published data can satisfy the requested valid time/range and exact field selection; run='latest_complete' selects the newest cycle published through f384. Explicit run timestamps remain reproducible. Use get_gfs_layer_diagnostics for deterministic calculations across two pressure surfaces. Use get_gfs_profile_diagnostics for freezing-level crossings and sampled temperature-inversion layers across an explicit set of pressure surfaces. Use get_gfs_parcel_diagnostics for an explicitly selected surface, 100-hPa mixed-layer, or sampled 300-hPa most-unstable parcel and its LCL/LFC/EL/CAPE/CIN. Use get_gfs_points when comparing multiple locations at one valid time, get_gfs_points_timeseries when the same locations must be compared across a valid-time range, and compare_gfs_runs when the same point/valid time/selection should be compared across consecutive six-hour model cycles. summarize_gfs_area accepts either one raw pressure-level variable at one pressure surface or one raw non-isobaric field and preserves exact vertical/temporal semantics. Run-comparison deltas are newer minus older; wind direction uses shortest signed angular change. Values are model data and deterministic physical derivations, not interpretation or safety advice.",
    },
  );
  const latestRunResolver = new LatestRunResolver();
  const profileService = new ProfileService({ latestRunProvider: latestRunResolver });
  const layerDiagnosticsService = new LayerDiagnosticsService({ profileGetter: profileService });
  const profileDiagnosticsService = new ProfileDiagnosticsService({ profileGetter: profileService });
  const parcelDiagnosticsService = new ParcelDiagnosticsService({ profileGetter: profileService });
  const batchPointsService = new BatchPointsService({ latestRunProvider: latestRunResolver, profileGetter: profileService });
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
    description: "List pressure-level variables, deterministic layer/profile/parcel diagnostics, and supported non-isobaric fields with canonical outputs, dependencies, and units.",
    inputSchema: z.object({}),
  }, async () => handleGetGfsCatalog());

  server.registerTool("get_latest_gfs_run", {
    title: "Get latest complete GFS run",
    description: "Resolve the latest complete NOAA GFS 0.25° cycle published through f384. Query tools use run='latest' for query-aware newest-available selection instead.",
    inputSchema: z.object({}),
    outputSchema: latestGfsRunResultSchema,
  }, async () => handleGetLatestGfsRun(latestRunResolver));

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

  server.registerTool("get_gfs_points", {
    title: "Get GFS fields for multiple points",
    description: "Return the same supported GFS field selection for up to 50 points at one valid time. Uses NOAA AWS byte ranges so the selected GRIB messages are fetched once and sampled at every requested point.",
    inputSchema: batchPointsQuerySchema,
    outputSchema: batchPointsResultSchema,
  }, async (query) => handleGetGfsPoints(batchPointsService, query));

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
    description: "Return bounded-area min, max, and unweighted grid-point mean for either one raw GFS pressure-level variable at one pressure surface or one raw non-isobaric field. Non-isobaric results include exact level and temporal semantics. Uses NOMADS geographic subsetting and does not return the raw grid.",
    inputSchema: areaSummaryQuerySchema,
    outputSchema: areaSummaryResultSchema,
  }, async (query) => handleGetGfsAreaSummary(areaSummaryService, query));

  return server;
}

void serveStdio(createServer);
