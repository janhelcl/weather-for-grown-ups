import type { GefsEnsembleProfileService } from "./core/gefs-ensemble-profile.js";
import type { GefsEnsembleTimeSeriesService } from "./core/gefs-ensemble-timeseries.js";
import type { GefsEnsembleService } from "./core/gefs-ensemble.js";
import {
  gefsEnsembleProfileResultSchema,
  type GefsEnsembleProfileQueryInput,
  type GefsEnsembleProfileResult,
} from "./schema/gefs-ensemble-profile.js";
import {
  gefsEnsembleTimeSeriesResultSchema,
  type GefsEnsembleTimeSeriesQueryInput,
  type GefsEnsembleTimeSeriesResult,
} from "./schema/gefs-ensemble-timeseries.js";
import {
  gefsEnsembleResultSchema,
  type GefsEnsembleQueryInput,
  type GefsEnsembleResult,
} from "./schema/gefs-ensemble.js";

export interface GefsEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export interface GefsEnsembleTimeSeriesGetter {
  getTimeSeries(query: GefsEnsembleTimeSeriesQueryInput): Promise<GefsEnsembleTimeSeriesResult>;
}

export interface GefsEnsembleProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export async function handleGetGefsEnsemble(
  service: Pick<GefsEnsembleService, "getEnsemble"> | GefsEnsembleGetter,
  query: GefsEnsembleQueryInput,
) {
  return handle(async () => gefsEnsembleResultSchema.parse(await service.getEnsemble(query)));
}

export async function handleGetGefsEnsembleTimeSeries(
  service: Pick<GefsEnsembleTimeSeriesService, "getTimeSeries"> | GefsEnsembleTimeSeriesGetter,
  query: GefsEnsembleTimeSeriesQueryInput,
) {
  return handle(async () => gefsEnsembleTimeSeriesResultSchema.parse(await service.getTimeSeries(query)));
}

export async function handleGetGefsEnsembleProfile(
  service: Pick<GefsEnsembleProfileService, "getProfile"> | GefsEnsembleProfileGetter,
  query: GefsEnsembleProfileQueryInput,
) {
  return handle(async () => gefsEnsembleProfileResultSchema.parse(await service.getProfile(query)));
}

async function handle<T extends Record<string, unknown>>(operation: () => Promise<T>) {
  try {
    const output = await operation();
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
