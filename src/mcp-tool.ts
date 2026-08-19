import type { LatestRunProvider } from "./core/latest-run.js";
import type { ProfileResult, TimeSeriesResult } from "./core/types.js";
import type { ProfileQueryInput, TimeSeriesQueryInput } from "./schema/query.js";

export interface ProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface TimeSeriesGetter {
  getTimeSeries(query: TimeSeriesQueryInput): Promise<TimeSeriesResult>;
}

export async function handleGetGfsProfile(profileService: ProfileGetter, query: ProfileQueryInput) {
  try {
    const output = await profileService.getProfile(query);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return toolError(error);
  }
}

export async function handleGetGfsTimeSeries(timeSeriesService: TimeSeriesGetter, query: TimeSeriesQueryInput) {
  try {
    const output = await timeSeriesService.getTimeSeries(query);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return toolError(error);
  }
}

export async function handleGetLatestGfsRun(latestRunProvider: LatestRunProvider) {
  try {
    const run = await latestRunProvider.resolveLatestRun();
    const output = {
      model: "gfs_0p25" as const,
      run: run.toISOString(),
      completeness: "f384" as const,
      discoverySource: "NOAA AWS Open Data" as const,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return toolError(error);
  }
}

function toolError(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}
