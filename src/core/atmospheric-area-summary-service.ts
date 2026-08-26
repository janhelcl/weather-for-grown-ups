import type {
  AreaSummaryQueryInput,
} from "../schema/area-summary.js";
import type { AreaSummaryResult } from "../schema/area-summary-result.js";
import type {
  GefsAreaSummaryQueryInput,
  GefsAreaSummaryResult,
} from "../schema/gefs-area-summary.js";
import type {
  HistoricalAreaSummaryQueryInput,
  HistoricalAreaSummaryResult,
} from "../schema/history-area-summary.js";
import { AreaSummaryService } from "./area-summary.js";
import { GefsAreaSummaryService } from "./gefs-area-summary.js";
import { HistoricalAreaSummaryService } from "./history-area-summary.js";

export type AtmosphericAreaSummaryRequest =
  | { model: "gfs_0p25"; query: AreaSummaryQueryInput }
  | { model: "gefs_0p50"; query: GefsAreaSummaryQueryInput }
  | { model: "gfs_grid4_analysis_0p5"; query: HistoricalAreaSummaryQueryInput };

export type AtmosphericAreaSummaryResult =
  | AreaSummaryResult
  | GefsAreaSummaryResult
  | HistoricalAreaSummaryResult;

export interface AtmosphericAreaSummaryServiceOptions {
  gfs?: Pick<AreaSummaryService, "summarize">;
  gefs?: Pick<GefsAreaSummaryService, "summarize">;
  history?: Pick<HistoricalAreaSummaryService, "summarize">;
}

export class AtmosphericAreaSummaryService {
  private readonly gfs: Pick<AreaSummaryService, "summarize">;
  private readonly gefs: Pick<GefsAreaSummaryService, "summarize">;
  private readonly history: Pick<HistoricalAreaSummaryService, "summarize">;

  constructor(options: AtmosphericAreaSummaryServiceOptions = {}) {
    this.gfs = options.gfs ?? new AreaSummaryService();
    this.gefs = options.gefs ?? new GefsAreaSummaryService();
    this.history = options.history ?? new HistoricalAreaSummaryService();
  }

  async summarize(request: AtmosphericAreaSummaryRequest): Promise<AtmosphericAreaSummaryResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.summarize(request.query);
      case "gefs_0p50":
        return this.gefs.summarize(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.summarize(request.query);
    }
  }
}
