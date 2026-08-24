import type { GefsAreaSummaryService } from "./core/gefs-area-summary.js";
import {
  gefsAreaSummaryResultSchema,
  type GefsAreaSummaryQueryInput,
} from "./schema/gefs-area-summary.js";

export interface GefsAreaSummaryGetter {
  summarize(query: GefsAreaSummaryQueryInput): ReturnType<GefsAreaSummaryService["summarize"]>;
}

export async function handleGetGefsAreaSummary(service: GefsAreaSummaryGetter, query: GefsAreaSummaryQueryInput) {
  try {
    const output = gefsAreaSummaryResultSchema.parse(await service.summarize(query));
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
