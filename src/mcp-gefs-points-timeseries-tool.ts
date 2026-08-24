import type { GefsPointsTimeSeriesService } from "./core/gefs-points-timeseries.js";
import {
  gefsPointsTimeSeriesResultSchema,
  type GefsPointsTimeSeriesQueryInput,
  type GefsPointsTimeSeriesResult,
} from "./schema/gefs-points-timeseries.js";

export interface GefsPointsTimeSeriesGetter {
  getPointsTimeSeries(query: GefsPointsTimeSeriesQueryInput): Promise<GefsPointsTimeSeriesResult>;
}

export async function handleGetGefsPointsTimeSeries(
  service: Pick<GefsPointsTimeSeriesService, "getPointsTimeSeries"> | GefsPointsTimeSeriesGetter,
  query: GefsPointsTimeSeriesQueryInput,
) {
  try {
    const output = gefsPointsTimeSeriesResultSchema.parse(await service.getPointsTimeSeries(query));
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
