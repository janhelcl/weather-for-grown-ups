import type { GfsGefsComparisonService } from "./core/gfs-gefs-comparison.js";
import {
  gfsGefsComparisonResultSchema,
  type GfsGefsComparisonQueryInput,
  type GfsGefsComparisonResult,
} from "./schema/gfs-gefs-comparison.js";

export interface GfsGefsComparisonGetter {
  compare(query: GfsGefsComparisonQueryInput): Promise<GfsGefsComparisonResult>;
}

export async function handleCompareGfsToGefs(
  service: Pick<GfsGefsComparisonService, "compare"> | GfsGefsComparisonGetter,
  query: GfsGefsComparisonQueryInput,
) {
  try {
    const output = gfsGefsComparisonResultSchema.parse(await service.compare(query));
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
