import type { GefsPointsBundleService } from "./core/gefs-points-bundle.js";
import {
  gefsPointsBundleResultSchema,
  type GefsPointsBundleQueryInput,
  type GefsPointsBundleResult,
} from "./schema/gefs-points-bundle.js";

export interface GefsPointsBundleGetter {
  getPoints(query: GefsPointsBundleQueryInput): Promise<GefsPointsBundleResult>;
}

export async function handleGetGefsFieldsPoints(
  service: Pick<GefsPointsBundleService, "getPoints"> | GefsPointsBundleGetter,
  query: GefsPointsBundleQueryInput,
) {
  try {
    const output = gefsPointsBundleResultSchema.parse(await service.getPoints(query));
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
