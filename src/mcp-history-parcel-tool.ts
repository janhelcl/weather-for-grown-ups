import type { HistoricalParcelTimeSeriesService } from "./core/history-parcel-timeseries.js";
import type { HistoricalParcelService } from "./core/history-parcel.js";
import {
  historicalParcelResultSchema,
  historicalParcelTimeSeriesResultSchema,
  type HistoricalParcelQueryInput,
  type HistoricalParcelTimeSeriesQueryInput,
} from "./schema/history-parcel.js";

export async function handleGetGfsHistoricalParcel(
  service: Pick<HistoricalParcelService, "getHistoricalParcel">,
  query: HistoricalParcelQueryInput,
) {
  try {
    const output = historicalParcelResultSchema.parse(await service.getHistoricalParcel(query));
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

export async function handleGetGfsHistoricalParcelTimeSeries(
  service: Pick<HistoricalParcelTimeSeriesService, "getHistoricalParcelTimeSeries">,
  query: HistoricalParcelTimeSeriesQueryInput,
) {
  try {
    const output = historicalParcelTimeSeriesResultSchema.parse(
      await service.getHistoricalParcelTimeSeries(query),
    );
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
