import type { AreaSummaryService } from "./core/area-summary.js";
import { areaSummaryResultSchema } from "./schema/area-summary-result.js";
import type { AreaSummaryQueryInput } from "./schema/area-summary.js";

export interface AreaSummaryGetter {
  summarize(query: AreaSummaryQueryInput): ReturnType<AreaSummaryService["summarize"]>;
}

export async function handleGetGfsAreaSummary(service: AreaSummaryGetter, query: AreaSummaryQueryInput) {
  try {
    const output = areaSummaryResultSchema.parse(await service.summarize(query));
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
