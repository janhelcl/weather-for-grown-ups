import type { TransectResult } from "./core/transect.js";
import { transectResultSchema } from "./schema/transect-result.js";
import type { TransectQueryInput } from "./schema/transect.js";

export interface TransectGetter {
  getTransect(query: TransectQueryInput): Promise<TransectResult>;
}

export async function handleGetGfsTransect(service: TransectGetter, query: TransectQueryInput) {
  try {
    const output = transectResultSchema.parse(await service.getTransect(query));
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
