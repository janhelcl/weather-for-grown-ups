import type { GefsTransectService } from "./core/gefs-transect.js";
import {
  gefsTransectResultSchema,
  type GefsTransectQueryInput,
  type GefsTransectResult,
} from "./schema/gefs-transect.js";

export interface GefsTransectGetter {
  getTransect(query: GefsTransectQueryInput): Promise<GefsTransectResult>;
}

export async function handleGetGefsTransect(
  service: Pick<GefsTransectService, "getTransect"> | GefsTransectGetter,
  query: GefsTransectQueryInput,
) {
  try {
    const output = gefsTransectResultSchema.parse(await service.getTransect(query));
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
