import { getGfsPressureCatalog } from "./catalog/catalog.js";
import type { LatestRunProvider } from "./core/latest-run.js";
import type {
  AreaSummaryResult,
  BatchPointsResult,
  LayerDiagnosticsResult,
  ProfileResult,
  TimeSeriesResult,
} from "./core/types.js";
import type {
  AreaSummaryQueryInput,
  BatchPointsQueryInput,
  LayerDiagnosticsQueryInput,
  ProfileQueryInput,
  TimeSeriesQueryInput,
} from "./schema/query.js";
import {
  areaSummaryResultSchema,
  batchPointsResultSchema,
  layerDiagnosticsResultSchema,
  latestGfsRunResultSchema,
  profileResultSchema,
  timeSeriesResultSchema,
} from "./schema/result.js";

export interface ProfileGetter { getProfile(query: ProfileQueryInput): Promise<ProfileResult>; }
export interface LayerDiagnosticsGetter { getLayerDiagnostics(query: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult>; }
export interface BatchPointsGetter { getPoints(query: BatchPointsQueryInput): Promise<BatchPointsResult>; }
export interface TimeSeriesGetter { getTimeSeries(query: TimeSeriesQueryInput): Promise<TimeSeriesResult>; }
export interface AreaSummaryGetter { summarize(query: AreaSummaryQueryInput): Promise<AreaSummaryResult>; }

export function handleGetGfsCatalog() {
  const output = getGfsPressureCatalog();
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: { ...output } };
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
