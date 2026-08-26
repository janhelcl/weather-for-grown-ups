import type { HistoricalFieldsTimeSeriesService } from "./core/history-fields-timeseries.js";
import type { HistoricalFieldsService } from "./core/history-fields.js";
import {
  historicalFieldsTimeSeriesResultSchema,
  type HistoricalFieldsTimeSeriesQueryInput,
} from "./schema/history-fields-timeseries.js";
import {
  historicalFieldsResultSchema,
  type HistoricalFieldsQueryInput,
} from "./schema/history-fields.js";

export async function handleGetGfsHistoricalFields(
  service: Pick<HistoricalFieldsService, "getHistoricalFields">,
  query: HistoricalFieldsQueryInput,
) {
  try {
    const output = historicalFieldsResultSchema.parse(await service.getHistoricalFields(query));
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

export async function handleGetGfsHistoricalFieldsTimeSeries(
  service: Pick<HistoricalFieldsTimeSeriesService, "getHistoricalFieldsTimeSeries">,
  query: HistoricalFieldsTimeSeriesQueryInput,
) {
  try {
    const output = historicalFieldsTimeSeriesResultSchema.parse(
      await service.getHistoricalFieldsTimeSeries(query),
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
