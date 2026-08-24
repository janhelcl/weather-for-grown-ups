import type { BatchPointsQueryInput } from "../schema/query.js";
import type { BatchPointsResult } from "./types.js";
import { BatchPointsService } from "./batch-points.js";
import type { GefsBatchPointsQueryInput, GefsBatchPointsResult } from "../schema/gefs-batch-points.js";
import { GefsBatchPointsService } from "./gefs-batch-points.js";

export type AtmosphericBatchPointsRequest =
  | { model: "gfs_0p25"; query: BatchPointsQueryInput }
  | { model: "gefs_0p50"; query: GefsBatchPointsQueryInput };

export type AtmosphericBatchPointsResult = BatchPointsResult | GefsBatchPointsResult;

export interface AtmosphericBatchPointsServiceOptions {
  gfs?: Pick<BatchPointsService, "getPoints">;
  gefs?: Pick<GefsBatchPointsService, "getPoints">;
}

export class AtmosphericBatchPointsService {
  private readonly gfs: Pick<BatchPointsService, "getPoints">;
  private readonly gefs: Pick<GefsBatchPointsService, "getPoints">;

  constructor(options: AtmosphericBatchPointsServiceOptions = {}) {
    this.gfs = options.gfs ?? new BatchPointsService();
    this.gefs = options.gefs ?? new GefsBatchPointsService();
  }

  async getPoints(request: AtmosphericBatchPointsRequest): Promise<AtmosphericBatchPointsResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getPoints(request.query);
      case "gefs_0p50":
        return this.gefs.getPoints(request.query);
    }
  }
}
