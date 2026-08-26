import type { HistoricalDiagnosticTimeSeriesService } from "./core/history-diagnostic-timeseries.js";
import type { HistoricalDiagnosticsService } from "./core/history-diagnostics.js";
import {
  historicalDiagnosticTimeSeriesResultSchema,
  type HistoricalDiagnosticTimeSeriesQueryInput,
} from "./schema/history-diagnostic-timeseries.js";
import {
  historicalLayerDiagnosticsResultSchema,
  historicalProfileDiagnosticsResultSchema,
  type HistoricalLayerDiagnosticsQueryInput,
  type HistoricalProfileDiagnosticsQueryInput,
} from "./schema/history-diagnostics.js";

export async function handleGetGfsHistoricalLayerDiagnostics(
  service: Pick<HistoricalDiagnosticsService, "getLayerDiagnostics">,
  query: HistoricalLayerDiagnosticsQueryInput,
) {
  try {
    const output = historicalLayerDiagnosticsResultSchema.parse(await service.getLayerDiagnostics(query));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetGfsHistoricalDiagnosticTimeSeries(
  service: Pick<HistoricalDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">,
  query: HistoricalDiagnosticTimeSeriesQueryInput,
) {
  try {
    const output = historicalDiagnosticTimeSeriesResultSchema.parse(
      await service.getDiagnosticTimeSeries(query),
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetGfsHistoricalProfileDiagnostics(
  service: Pick<HistoricalDiagnosticsService, "getProfileDiagnostics">,
  query: HistoricalProfileDiagnosticsQueryInput,
) {
  try {
    const output = historicalProfileDiagnosticsResultSchema.parse(await service.getProfileDiagnostics(query));
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
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}
