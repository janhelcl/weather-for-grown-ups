import type { GefsEnsembleService } from "./core/gefs-ensemble.js";
import {
  gefsEnsembleResultSchema,
  type GefsEnsembleQueryInput,
  type GefsEnsembleResult,
} from "./schema/gefs-ensemble.js";

export interface GefsEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export async function handleGetGefsEnsemble(
  service: Pick<GefsEnsembleService, "getEnsemble"> | GefsEnsembleGetter,
  query: GefsEnsembleQueryInput,
) {
  try {
    const output = gefsEnsembleResultSchema.parse(await service.getEnsemble(query));
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
