import type { GefsPointsBundleTimeSeriesService } from "./core/gefs-points-bundle-timeseries.js";
import {
  gefsPointsBundleTimeSeriesResultSchema,
  type GefsPointsBundleTimeSeriesQueryInput,
  type GefsPointsBundleTimeSeriesResult,
} from "./schema/gefs-points-bundle-timeseries.js";

export interface GefsPointsBundleTimeSeriesGetter {
  getPointsTimeSeries(query: GefsPointsBundleTimeSeriesQueryInput): Promise<GefsPointsBundleTimeSeriesResult>;
}

export async function handleGetGefsFieldsPointsTimeSeries(
  service: Pick<GefsPointsBundleTimeSeriesService, "getPointsTimeSeries"> | GefsPointsBundleTimeSeriesGetter,
  query: GefsPointsBundleTimeSeriesQueryInput,
) {
  try {
    const output = gefsPointsBundleTimeSeriesResultSchema.parse(await service.getPointsTimeSeries(query));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true as const,
    };
  }
}
