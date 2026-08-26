import type { HistoricalProfileService } from "./core/history.js";
import type { HistoricalProfileQueryInput } from "./schema/history.js";
import { historicalProfileResultSchema } from "./schema/history-result.js";

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
    return {
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      }],
      isError: true as const,
    };
  }
}
