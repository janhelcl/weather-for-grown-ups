import type { HistoricalPointsService } from "./core/history-points.js";
import {
  historicalPointsResultSchema,
  type HistoricalPointsQueryInput,
} from "./schema/history-points.js";

export async function handleGetGfsHistoricalPoints(
  service: Pick<HistoricalPointsService, "getPoints">,
  query: HistoricalPointsQueryInput,
) {
  try {
    const output = historicalPointsResultSchema.parse(await service.getPoints(query));
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
