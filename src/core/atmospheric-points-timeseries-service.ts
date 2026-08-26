import type {
  GefsPointsTimeSeriesQueryInput,
  GefsPointsTimeSeriesResult,
} from "../schema/gefs-points-timeseries.js";
import type {
  HistoricalPointsTimeSeriesQueryInput,
  HistoricalPointsTimeSeriesResult,
} from "../schema/history-points-timeseries.js";
import type { PointsTimeSeriesQueryInput } from "../schema/query.js";
import { GefsPointsTimeSeriesService } from "./gefs-points-timeseries.js";
import { HistoricalPointsTimeSeriesService } from "./history-points-timeseries.js";
import { PointsTimeSeriesService } from "./points-time-series.js";
import type { PointsTimeSeriesResult } from "./types.js";

export type AtmosphericPointsTimeSeriesRequest =
  | { model: "gfs_0p25"; query: PointsTimeSeriesQueryInput }
  | { model: "gefs_0p50"; query: GefsPointsTimeSeriesQueryInput }
  | { model: "gfs_grid4_analysis_0p5"; query: HistoricalPointsTimeSeriesQueryInput };

export type AtmosphericPointsTimeSeriesResult =
  | PointsTimeSeriesResult
  | GefsPointsTimeSeriesResult
  | HistoricalPointsTimeSeriesResult;

export interface AtmosphericPointsTimeSeriesServiceOptions {
  gfs?: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  gefs?: Pick<GefsPointsTimeSeriesService, "getPointsTimeSeries">;
  history?: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;
}

export class AtmosphericPointsTimeSeriesService {
  private readonly gfs: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly gefs: Pick<GefsPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly history: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;

  constructor(options: AtmosphericPointsTimeSeriesServiceOptions = {}) {
    this.gfs = options.gfs ?? new PointsTimeSeriesService();
    this.gefs = options.gefs ?? new GefsPointsTimeSeriesService();
    this.history = options.history ?? new HistoricalPointsTimeSeriesService();
  }

  async getPointsTimeSeries(
    request: AtmosphericPointsTimeSeriesRequest,
  ): Promise<AtmosphericPointsTimeSeriesResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getPointsTimeSeries(request.query);
      case "gefs_0p50":
        return this.gefs.getPointsTimeSeries(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getPointsTimeSeries(request.query);
    }
  }
}
