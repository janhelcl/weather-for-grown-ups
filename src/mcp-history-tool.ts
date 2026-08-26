import type { HistoricalTimeSeriesService } from "./core/history-time-series.js";
import type { HistoricalProfileService } from "./core/history.js";
import type {
  HistoricalProfileQueryInput,
  HistoricalTimeSeriesQueryInput,
} from "./schema/history.js";
import {
  historicalProfileResultSchema,
  historicalTimeSeriesResultSchema,
} from "./schema/history-result.js";

export async function handleGetGfsHistoricalProfile(
  historyService: Pick<HistoricalProfileService, "getHistoricalProfile">,
  query: HistoricalProfileQueryInput,
) {
  try {
    const output = historicalProfileResultSchema.parse(
      await historyService.getHistoricalProfile(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetGfsHistoricalTimeSeries(
  historyTimeSeriesService: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">,
  query: HistoricalTimeSeriesQueryInput,
) {
  try {
    const output = historicalTimeSeriesResultSchema.parse(
      await historyTimeSeriesService.getHistoricalTimeSeries(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

function errorResult(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error),
    }],
    isError: true as const,
  };
}
