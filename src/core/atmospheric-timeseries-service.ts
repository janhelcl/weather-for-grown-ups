import {
  atmosphericTimeSeriesRequestSchema,
  atmosphericTimeSeriesResultSchema,
  type AtmosphericTimeSeriesRequestInput,
  type AtmosphericTimeSeriesResult,
} from "../schema/atmospheric-timeseries.js";
import type {
  GefsEnsembleTimeSeriesQueryInput,
  GefsEnsembleTimeSeriesResult,
} from "../schema/gefs-ensemble-timeseries.js";
import type { HistoricalTimeSeriesQueryInput } from "../schema/history.js";
import type { HistoricalTimeSeriesResult } from "../schema/history-result.js";
import type { TimeSeriesQueryInput } from "../schema/query.js";
import type { TimeSeriesResult } from "./types.js";
import { GefsEnsembleTimeSeriesService } from "./gefs-ensemble-timeseries.js";
import { HistoricalTimeSeriesService } from "./history-time-series.js";
import { TimeSeriesService } from "./time-series.js";

export interface DeterministicTimeSeriesGetter {
  getTimeSeries(query: TimeSeriesQueryInput): Promise<TimeSeriesResult>;
}

export interface EnsembleTimeSeriesGetter {
  getTimeSeries(query: GefsEnsembleTimeSeriesQueryInput): Promise<GefsEnsembleTimeSeriesResult>;
}

export interface HistoricalTimeSeriesGetter {
  getHistoricalTimeSeries(query: HistoricalTimeSeriesQueryInput): Promise<HistoricalTimeSeriesResult>;
}

export interface AtmosphericTimeSeriesServiceOptions {
  gfs?: DeterministicTimeSeriesGetter;
  gefs?: EnsembleTimeSeriesGetter;
  history?: HistoricalTimeSeriesGetter;
}

export class AtmosphericTimeSeriesService {
  private readonly gfs: DeterministicTimeSeriesGetter;
  private readonly gefs: EnsembleTimeSeriesGetter;
  private readonly history: HistoricalTimeSeriesGetter;

  constructor(options: AtmosphericTimeSeriesServiceOptions = {}) {
    this.gfs = options.gfs ?? new TimeSeriesService();
    this.gefs = options.gefs ?? new GefsEnsembleTimeSeriesService();
    this.history = options.history ?? new HistoricalTimeSeriesService();
  }

  async getTimeSeries(input: AtmosphericTimeSeriesRequestInput): Promise<AtmosphericTimeSeriesResult> {
    const request = atmosphericTimeSeriesRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericTimeSeriesResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericTimeSeriesRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getTimeSeries(request.query);
      case "gefs_0p50":
        return this.gefs.getTimeSeries(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getHistoricalTimeSeries(request.query);
    }
  }
}
