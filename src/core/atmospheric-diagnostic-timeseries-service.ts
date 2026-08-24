import {
  atmosphericDiagnosticTimeSeriesRequestSchema,
  atmosphericDiagnosticTimeSeriesResultSchema,
  type AtmosphericDiagnosticTimeSeriesRequestInput,
  type AtmosphericDiagnosticTimeSeriesResult,
} from "../schema/atmospheric-diagnostic-timeseries.js";
import type { DiagnosticTimeSeriesQueryInput } from "../schema/diagnostic-time-series.js";
import type { DiagnosticTimeSeriesResult } from "../schema/diagnostic-time-series-result.js";
import type {
  GefsDiagnosticTimeSeriesQueryInput,
  GefsDiagnosticTimeSeriesResult,
} from "../schema/gefs-diagnostic-timeseries.js";
import { DiagnosticTimeSeriesService } from "./diagnostic-time-series.js";
import { GefsDiagnosticTimeSeriesService } from "./gefs-diagnostic-timeseries.js";

export interface DeterministicDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: DiagnosticTimeSeriesQueryInput): Promise<DiagnosticTimeSeriesResult>;
}

export interface EnsembleDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: GefsDiagnosticTimeSeriesQueryInput): Promise<GefsDiagnosticTimeSeriesResult>;
}

export interface AtmosphericDiagnosticTimeSeriesServiceOptions {
  gfs?: DeterministicDiagnosticTimeSeriesGetter;
  gefs?: EnsembleDiagnosticTimeSeriesGetter;
}

export class AtmosphericDiagnosticTimeSeriesService {
  private readonly gfs: DeterministicDiagnosticTimeSeriesGetter;
  private readonly gefs: EnsembleDiagnosticTimeSeriesGetter;

  constructor(options: AtmosphericDiagnosticTimeSeriesServiceOptions = {}) {
    this.gfs = options.gfs ?? new DiagnosticTimeSeriesService();
    this.gefs = options.gefs ?? new GefsDiagnosticTimeSeriesService();
  }

  async getDiagnosticTimeSeries(input: AtmosphericDiagnosticTimeSeriesRequestInput): Promise<AtmosphericDiagnosticTimeSeriesResult> {
    const request = atmosphericDiagnosticTimeSeriesRequestSchema.parse(input);
    const result = request.model === "gfs_0p25"
      ? await this.gfs.getDiagnosticTimeSeries(request.query)
      : await this.gefs.getDiagnosticTimeSeries(request.query);
    return atmosphericDiagnosticTimeSeriesResultSchema.parse(result);
  }
}
