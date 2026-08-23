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
import type { TimeSeriesQueryInput } from "../schema/query.js";
import type { TimeSeriesResult } from "./types.js";
import { GefsEnsembleTimeSeriesService } from "./gefs-ensemble-timeseries.js";
import { TimeSeriesService } from "./time-series.js";

export interface DeterministicTimeSeriesGetter {
  getTimeSeries(query: TimeSeriesQueryInput): Promise<TimeSeriesResult>;
}

export interface EnsembleTimeSeriesGetter {
  getTimeSeries(query: GefsEnsembleTimeSeriesQueryInput): Promise<GefsEnsembleTimeSeriesResult>;
}

export interface AtmosphericTimeSeriesServiceOptions {
  gfs?: DeterministicTimeSeriesGetter;
  gefs?: EnsembleTimeSeriesGetter;
}

export class AtmosphericTimeSeriesService {
  private readonly gfs: DeterministicTimeSeriesGetter;
  private readonly gefs: EnsembleTimeSeriesGetter;

  constructor(options: AtmosphericTimeSeriesServiceOptions = {}) {
    this.gfs = options.gfs ?? new TimeSeriesService();
    this.gefs = options.gefs ?? new GefsEnsembleTimeSeriesService();
  }

  async getTimeSeries(input: AtmosphericTimeSeriesRequestInput): Promise<AtmosphericTimeSeriesResult> {
    const request = atmosphericTimeSeriesRequestSchema.parse(input);
    const result = request.model === "gfs_0p25"
      ? await this.gfs.getTimeSeries(request.query)
      : await this.gefs.getTimeSeries(request.query);
    return atmosphericTimeSeriesResultSchema.parse(result);
  }
}
