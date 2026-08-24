import type { GefsDiagnosticTimeSeriesService } from "./core/gefs-diagnostic-timeseries.js";
import type { GefsEnsembleProfileService } from "./core/gefs-ensemble-profile.js";
import type { GefsEnsembleTimeSeriesService } from "./core/gefs-ensemble-timeseries.js";
import type { GefsEnsembleService } from "./core/gefs-ensemble.js";
import type { GefsLayerDiagnosticsService } from "./core/gefs-layer-diagnostics.js";
import type { GefsProfileDiagnosticsService } from "./core/gefs-profile-diagnostics.js";
import type { GefsRunComparisonService } from "./core/gefs-run-comparison.js";
import {
  gefsDiagnosticTimeSeriesResultSchema,
  type GefsDiagnosticTimeSeriesQueryInput,
  type GefsDiagnosticTimeSeriesResult,
} from "./schema/gefs-diagnostic-timeseries.js";
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
import {
  gefsLayerDiagnosticsResultSchema,
  type GefsLayerDiagnosticsQueryInput,
  type GefsLayerDiagnosticsResult,
} from "./schema/gefs-layer-diagnostics.js";
import {
  gefsProfileDiagnosticsResultSchema,
  type GefsProfileDiagnosticsQueryInput,
  type GefsProfileDiagnosticsResult,
} from "./schema/gefs-profile-diagnostics.js";
import {
  gefsRunComparisonResultSchema,
  type GefsRunComparisonQueryInput,
  type GefsRunComparisonResult,
} from "./schema/gefs-run-comparison.js";

export interface GefsEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export interface GefsEnsembleTimeSeriesGetter {
  getTimeSeries(query: GefsEnsembleTimeSeriesQueryInput): Promise<GefsEnsembleTimeSeriesResult>;
}

export interface GefsEnsembleProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export interface GefsLayerDiagnosticsGetter {
  getLayerDiagnostics(query: GefsLayerDiagnosticsQueryInput): Promise<GefsLayerDiagnosticsResult>;
}

export interface GefsProfileDiagnosticsGetter {
  getProfileDiagnostics(query: GefsProfileDiagnosticsQueryInput): Promise<GefsProfileDiagnosticsResult>;
}

export interface GefsDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: GefsDiagnosticTimeSeriesQueryInput): Promise<GefsDiagnosticTimeSeriesResult>;
}

export interface GefsRunComparisonGetter {
  compareRuns(query: GefsRunComparisonQueryInput): Promise<GefsRunComparisonResult>;
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

export async function handleGetGefsLayerDiagnostics(
  service: Pick<GefsLayerDiagnosticsService, "getLayerDiagnostics"> | GefsLayerDiagnosticsGetter,
  query: GefsLayerDiagnosticsQueryInput,
) {
  return handle(async () => gefsLayerDiagnosticsResultSchema.parse(await service.getLayerDiagnostics(query)));
}

export async function handleGetGefsProfileDiagnostics(
  service: Pick<GefsProfileDiagnosticsService, "getProfileDiagnostics"> | GefsProfileDiagnosticsGetter,
  query: GefsProfileDiagnosticsQueryInput,
) {
  return handle(async () => gefsProfileDiagnosticsResultSchema.parse(await service.getProfileDiagnostics(query)));
}

export async function handleGetGefsDiagnosticTimeSeries(
  service: Pick<GefsDiagnosticTimeSeriesService, "getDiagnosticTimeSeries"> | GefsDiagnosticTimeSeriesGetter,
  query: GefsDiagnosticTimeSeriesQueryInput,
) {
  return handle(async () => gefsDiagnosticTimeSeriesResultSchema.parse(await service.getDiagnosticTimeSeries(query)));
}

export async function handleCompareGefsRuns(
  service: Pick<GefsRunComparisonService, "compareRuns"> | GefsRunComparisonGetter,
  query: GefsRunComparisonQueryInput,
) {
  return handle(async () => gefsRunComparisonResultSchema.parse(await service.compareRuns(query)));
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
