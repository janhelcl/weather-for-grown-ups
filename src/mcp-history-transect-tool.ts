import type { HistoricalTransectService } from "./core/history-transect.js";
import {
  historicalTransectResultSchema,
  type HistoricalTransectQueryInput,
} from "./schema/history-transect.js";

export async function handleGetGfsHistoricalTransect(
  service: Pick<HistoricalTransectService, "getTransect">,
  query: HistoricalTransectQueryInput,
) {
  try {
    const output = historicalTransectResultSchema.parse(await service.getTransect(query));
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
