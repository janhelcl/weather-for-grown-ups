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
import type {
  HistoricalDiagnosticTimeSeriesQueryInput,
  HistoricalDiagnosticTimeSeriesResult,
} from "../schema/history-diagnostic-timeseries.js";
import { DiagnosticTimeSeriesService } from "./diagnostic-time-series.js";
import { GefsDiagnosticTimeSeriesService } from "./gefs-diagnostic-timeseries.js";
import { HistoricalDiagnosticTimeSeriesService } from "./history-diagnostic-timeseries.js";

export interface DeterministicDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: DiagnosticTimeSeriesQueryInput): Promise<DiagnosticTimeSeriesResult>;
}

export interface EnsembleDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: GefsDiagnosticTimeSeriesQueryInput): Promise<GefsDiagnosticTimeSeriesResult>;
}

export interface HistoricalDiagnosticTimeSeriesGetter {
  getDiagnosticTimeSeries(query: HistoricalDiagnosticTimeSeriesQueryInput): Promise<HistoricalDiagnosticTimeSeriesResult>;
}

export interface AtmosphericDiagnosticTimeSeriesServiceOptions {
  gfs?: DeterministicDiagnosticTimeSeriesGetter;
  gefs?: EnsembleDiagnosticTimeSeriesGetter;
  history?: HistoricalDiagnosticTimeSeriesGetter;
}

export class AtmosphericDiagnosticTimeSeriesService {
  private readonly gfs: DeterministicDiagnosticTimeSeriesGetter;
  private readonly gefs: EnsembleDiagnosticTimeSeriesGetter;
  private readonly history: HistoricalDiagnosticTimeSeriesGetter;

  constructor(options: AtmosphericDiagnosticTimeSeriesServiceOptions = {}) {
    this.gfs = options.gfs ?? new DiagnosticTimeSeriesService();
    this.gefs = options.gefs ?? new GefsDiagnosticTimeSeriesService();
    this.history = options.history ?? new HistoricalDiagnosticTimeSeriesService();
  }

  async getDiagnosticTimeSeries(input: AtmosphericDiagnosticTimeSeriesRequestInput): Promise<AtmosphericDiagnosticTimeSeriesResult> {
    const request = atmosphericDiagnosticTimeSeriesRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericDiagnosticTimeSeriesResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericDiagnosticTimeSeriesRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
      case "gfs_0p50":
        return this.gfs.getDiagnosticTimeSeries(request.query);
      case "gefs_0p50":
        return this.gefs.getDiagnosticTimeSeries(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getDiagnosticTimeSeries(request.query);
    }
  }
}
