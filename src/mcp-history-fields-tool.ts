import type { HistoricalFieldsService } from "./core/history-fields.js";
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
