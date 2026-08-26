import type { GefsBatchPointsQueryInput, GefsBatchPointsResult } from "../schema/gefs-batch-points.js";
import type { HistoricalPointsQueryInput, HistoricalPointsResult } from "../schema/history-points.js";
import type { BatchPointsQueryInput } from "../schema/query.js";
import { BatchPointsService } from "./batch-points.js";
import { GefsBatchPointsService } from "./gefs-batch-points.js";
import { HistoricalPointsService } from "./history-points.js";
import type { BatchPointsResult } from "./types.js";

export type AtmosphericBatchPointsRequest =
  | { model: "gfs_0p25"; query: BatchPointsQueryInput }
  | { model: "gefs_0p50"; query: GefsBatchPointsQueryInput }
  | { model: "gfs_grid4_analysis_0p5"; query: HistoricalPointsQueryInput };

export type AtmosphericBatchPointsResult =
  | BatchPointsResult
  | GefsBatchPointsResult
  | HistoricalPointsResult;

export interface AtmosphericBatchPointsServiceOptions {
  gfs?: Pick<BatchPointsService, "getPoints">;
  gefs?: Pick<GefsBatchPointsService, "getPoints">;
  history?: Pick<HistoricalPointsService, "getPoints">;
}

export class AtmosphericBatchPointsService {
  private readonly gfs: Pick<BatchPointsService, "getPoints">;
  private readonly gefs: Pick<GefsBatchPointsService, "getPoints">;
  private readonly history: Pick<HistoricalPointsService, "getPoints">;

  constructor(options: AtmosphericBatchPointsServiceOptions = {}) {
    this.gfs = options.gfs ?? new BatchPointsService();
    this.gefs = options.gefs ?? new GefsBatchPointsService();
    this.history = options.history ?? new HistoricalPointsService();
  }

  async getPoints(request: AtmosphericBatchPointsRequest): Promise<AtmosphericBatchPointsResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getPoints(request.query);
      case "gefs_0p50":
        return this.gefs.getPoints(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getPoints(request.query);
    }
  }
}
