import type {
  GefsTransectQueryInput,
  GefsTransectResult,
} from "../schema/gefs-transect.js";
import type {
  HistoricalTransectQueryInput,
  HistoricalTransectResult,
} from "../schema/history-transect.js";
import type { TransectQueryInput } from "../schema/transect.js";
import { GefsTransectService } from "./gefs-transect.js";
import { HistoricalTransectService } from "./history-transect.js";
import { TransectService, type TransectResult } from "./transect.js";

export type AtmosphericTransectRequest =
  | { model: "gfs_0p25"; query: TransectQueryInput }
  | { model: "gefs_0p50"; query: GefsTransectQueryInput }
  | { model: "gfs_grid4_analysis_0p5"; query: HistoricalTransectQueryInput };

export type AtmosphericTransectResult =
  | TransectResult
  | GefsTransectResult
  | HistoricalTransectResult;

export interface AtmosphericTransectServiceOptions {
  gfs?: Pick<TransectService, "getTransect">;
  gefs?: Pick<GefsTransectService, "getTransect">;
  history?: Pick<HistoricalTransectService, "getTransect">;
}

export class AtmosphericTransectService {
  private readonly gfs: Pick<TransectService, "getTransect">;
  private readonly gefs: Pick<GefsTransectService, "getTransect">;
  private readonly history: Pick<HistoricalTransectService, "getTransect">;

  constructor(options: AtmosphericTransectServiceOptions = {}) {
    this.gfs = options.gfs ?? new TransectService();
    this.gefs = options.gefs ?? new GefsTransectService();
    this.history = options.history ?? new HistoricalTransectService();
  }

  async getTransect(request: AtmosphericTransectRequest): Promise<AtmosphericTransectResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getTransect(request.query);
      case "gefs_0p50":
        return this.gefs.getTransect(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getTransect(request.query);
    }
  }
}
