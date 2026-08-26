import type { HistoricalIndexService } from "./core/history-index.js";
import type { HistoricalTimeSeriesService } from "./core/history-time-series.js";
import type { HistoricalForecastVerificationService } from "./core/history-verification.js";
import type { HistoricalProfileService } from "./core/history.js";
import type {
  HistoricalProfileQueryInput,
  HistoricalTimeSeriesQueryInput,
} from "./schema/history.js";
import {
  historicalProfileResultSchema,
  historicalTimeSeriesResultSchema,
} from "./schema/history-result.js";
import type {
  HistoricalAnalogQueryInput,
  HistoricalIndexBuildQueryInput,
} from "./schema/history-index.js";
import {
  historicalAnalogResultSchema,
  historicalIndexBuildResultSchema,
} from "./schema/history-index.js";
import type { HistoricalForecastVerificationQueryInput } from "./schema/history-verification.js";
import { historicalForecastVerificationResultSchema } from "./schema/history-verification-result.js";

export async function handleGetGfsHistoricalProfile(
  historyService: Pick<HistoricalProfileService, "getHistoricalProfile">,
  query: HistoricalProfileQueryInput,
) {
  try {
    const output = historicalProfileResultSchema.parse(
      await historyService.getHistoricalProfile(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetGfsHistoricalTimeSeries(
  historyTimeSeriesService: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">,
  query: HistoricalTimeSeriesQueryInput,
) {
  try {
    const output = historicalTimeSeriesResultSchema.parse(
      await historyTimeSeriesService.getHistoricalTimeSeries(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleMaterializeGfsHistoryIndex(
  indexService: Pick<HistoricalIndexService, "materialize">,
  query: HistoricalIndexBuildQueryInput,
) {
  try {
    const output = historicalIndexBuildResultSchema.parse(await indexService.materialize(query));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleFindGfsHistoricalAnalogs(
  indexService: Pick<HistoricalIndexService, "findAnalogs">,
  query: HistoricalAnalogQueryInput,
) {
  try {
    const output = historicalAnalogResultSchema.parse(await indexService.findAnalogs(query));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleVerifyGfsHistoricalForecast(
  verificationService: Pick<HistoricalForecastVerificationService, "verify">,
  query: HistoricalForecastVerificationQueryInput,
) {
  try {
    const output = historicalForecastVerificationResultSchema.parse(
      await verificationService.verify(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

function errorResult(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error),
    }],
    isError: true as const,
  };
}
