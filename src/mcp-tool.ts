import { getGfsPressureCatalog } from "./catalog/catalog.js";
import { searchGfsCatalog } from "./catalog/search.js";
import type { LatestRunProvider } from "./core/latest-run.js";
import type { RunComparisonResult } from "./core/run-comparison.js";
import type {
  AreaSummaryResult,
  BatchPointsResult,
  LayerDiagnosticsResult,
  ParcelDiagnosticsResult,
  PointsTimeSeriesResult,
  ProfileDiagnosticsResult,
  ProfileResult,
  TimeSeriesResult,
} from "./core/types.js";
import {
  catalogSearchResultSchema,
  type CatalogSearchQueryInput,
} from "./schema/catalog-search.js";
import type { DiagnosticTimeSeriesQueryInput } from "./schema/diagnostic-time-series.js";
import {
  diagnosticTimeSeriesResultSchema,
  type DiagnosticTimeSeriesResult,
} from "./schema/diagnostic-time-series-result.js";
import type {
  AreaSummaryQueryInput,
  BatchPointsQueryInput,
  LayerDiagnosticsQueryInput,
  ParcelDiagnosticsQueryInput,
  PointsTimeSeriesQueryInput,
  ProfileDiagnosticsQueryInput,
  ProfileQueryInput,
  RunComparisonQueryInput,
  TimeSeriesQueryInput,
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

export interface ProfileGetter { getProfile(query: ProfileQueryInput): Promise<ProfileResult>; }
export interface LayerDiagnosticsGetter { getLayerDiagnostics(query: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult>; }
export interface ProfileDiagnosticsGetter { getProfileDiagnostics(query: ProfileDiagnosticsQueryInput): Promise<ProfileDiagnosticsResult>; }
export interface ParcelDiagnosticsGetter { getParcelDiagnostics(query: ParcelDiagnosticsQueryInput): Promise<ParcelDiagnosticsResult>; }
export interface BatchPointsGetter { getPoints(query: BatchPointsQueryInput): Promise<BatchPointsResult>; }
export interface TimeSeriesGetter { getTimeSeries(query: TimeSeriesQueryInput): Promise<TimeSeriesResult>; }
export interface DiagnosticTimeSeriesGetter { getDiagnosticTimeSeries(query: DiagnosticTimeSeriesQueryInput): Promise<DiagnosticTimeSeriesResult>; }
export interface PointsTimeSeriesGetter { getPointsTimeSeries(query: PointsTimeSeriesQueryInput): Promise<PointsTimeSeriesResult>; }
export interface RunComparisonGetter { compareRuns(query: RunComparisonQueryInput): Promise<RunComparisonResult>; }
export interface AreaSummaryGetter { summarize(query: AreaSummaryQueryInput): Promise<AreaSummaryResult>; }

export function handleGetGfsCatalog() {
  const output = getGfsPressureCatalog();
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
}

export function handleSearchGfsCatalog(query: CatalogSearchQueryInput) {
  try {
    const output = catalogSearchResultSchema.parse(searchGfsCatalog(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsAreaSummary(areaService: AreaSummaryGetter, query: AreaSummaryQueryInput) {
  try {
    const output = areaSummaryResultSchema.parse(await areaService.summarize(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsProfile(profileService: ProfileGetter, query: ProfileQueryInput) {
  try {
    const output = profileResultSchema.parse(await profileService.getProfile(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsLayerDiagnostics(layerService: LayerDiagnosticsGetter, query: LayerDiagnosticsQueryInput) {
  try {
    const output = layerDiagnosticsResultSchema.parse(await layerService.getLayerDiagnostics(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsProfileDiagnostics(profileDiagnosticsService: ProfileDiagnosticsGetter, query: ProfileDiagnosticsQueryInput) {
  try {
    const output = profileDiagnosticsResultSchema.parse(await profileDiagnosticsService.getProfileDiagnostics(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsParcelDiagnostics(parcelService: ParcelDiagnosticsGetter, query: ParcelDiagnosticsQueryInput) {
  try {
    const output = parcelDiagnosticsResultSchema.parse(await parcelService.getParcelDiagnostics(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsPoints(batchService: BatchPointsGetter, query: BatchPointsQueryInput) {
  try {
    const output = batchPointsResultSchema.parse(await batchService.getPoints(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsTimeSeries(timeSeriesService: TimeSeriesGetter, query: TimeSeriesQueryInput) {
  try {
    const output = timeSeriesResultSchema.parse(await timeSeriesService.getTimeSeries(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsDiagnosticTimeSeries(
  diagnosticTimeSeriesService: DiagnosticTimeSeriesGetter,
  query: DiagnosticTimeSeriesQueryInput,
) {
  try {
    const output = diagnosticTimeSeriesResultSchema.parse(
      await diagnosticTimeSeriesService.getDiagnosticTimeSeries(query),
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetGfsPointsTimeSeries(
  pointsTimeSeriesService: PointsTimeSeriesGetter,
  query: PointsTimeSeriesQueryInput,
) {
  try {
    const output = pointsTimeSeriesResultSchema.parse(
      await pointsTimeSeriesService.getPointsTimeSeries(query),
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleCompareGfsRuns(
  runComparisonService: RunComparisonGetter,
  query: RunComparisonQueryInput,
) {
  try {
    const output = runComparisonResultSchema.parse(await runComparisonService.compareRuns(query));
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

export async function handleGetLatestGfsRun(latestRunProvider: LatestRunProvider) {
  try {
    const run = await latestRunProvider.resolveLatestRun();
    const output = latestGfsRunResultSchema.parse({
      model: "gfs_0p25",
      run: run.toISOString(),
      completeness: "f384",
      discoverySource: "NOAA AWS Open Data",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
  } catch (error) { return toolError(error); }
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true as const };
}
