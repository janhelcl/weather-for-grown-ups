import type { HistoricalAreaSummaryService } from "./core/history-area-summary.js";
import {
  historicalAreaSummaryResultSchema,
  type HistoricalAreaSummaryQueryInput,
} from "./schema/history-area-summary.js";

export interface HistoricalAreaSummaryGetter {
  summarize(query: HistoricalAreaSummaryQueryInput): ReturnType<HistoricalAreaSummaryService["summarize"]>;
}

export async function handleGetGfsHistoricalAreaSummary(
  service: HistoricalAreaSummaryGetter,
  query: HistoricalAreaSummaryQueryInput,
) {
  try {
    const output = historicalAreaSummaryResultSchema.parse(await service.summarize(query));
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
