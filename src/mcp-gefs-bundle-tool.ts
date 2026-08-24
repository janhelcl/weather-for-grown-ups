import type { GefsBundleTimeSeriesService } from "./core/gefs-bundle-timeseries.js";
import type { GefsMemberBundleService } from "./core/gefs-member-bundle.js";
import {
  gefsBundleTimeSeriesResultSchema,
  type GefsBundleTimeSeriesQueryInput,
  type GefsBundleTimeSeriesResult,
} from "./schema/gefs-bundle-timeseries.js";
import {
  gefsMemberBundleResultSchema,
  type GefsMemberBundleQueryInput,
  type GefsMemberBundleResult,
} from "./schema/gefs-member-bundle.js";

export interface GefsMemberBundleGetter {
  getBundle(query: GefsMemberBundleQueryInput): Promise<GefsMemberBundleResult>;
}

export interface GefsBundleTimeSeriesGetter {
  getTimeSeries(query: GefsBundleTimeSeriesQueryInput): Promise<GefsBundleTimeSeriesResult>;
}

export async function handleGetGefsFields(
  service: Pick<GefsMemberBundleService, "getBundle"> | GefsMemberBundleGetter,
  query: GefsMemberBundleQueryInput,
) {
  return handle(async () => gefsMemberBundleResultSchema.parse(await service.getBundle(query)));
}

export async function handleGetGefsFieldsTimeSeries(
  service: Pick<GefsBundleTimeSeriesService, "getTimeSeries"> | GefsBundleTimeSeriesGetter,
  query: GefsBundleTimeSeriesQueryInput,
) {
  return handle(async () => gefsBundleTimeSeriesResultSchema.parse(await service.getTimeSeries(query)));
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
