import type { RunComparisonQueryInput } from "../schema/query.js";
import type { RunComparisonResult } from "./run-comparison.js";
import { RunComparisonService } from "./run-comparison.js";
import type {
  GefsRunComparisonQueryInput,
  GefsRunComparisonResult,
} from "../schema/gefs-run-comparison.js";
import { GefsRunComparisonService } from "./gefs-run-comparison.js";

export type AtmosphericRunComparisonRequest =
  | { model: "gfs_0p25"; query: RunComparisonQueryInput }
  | { model: "gefs_0p50"; query: GefsRunComparisonQueryInput };

export type AtmosphericRunComparisonResult = RunComparisonResult | GefsRunComparisonResult;

export interface AtmosphericRunComparisonServiceOptions {
  gfs?: Pick<RunComparisonService, "compareRuns">;
  gefs?: Pick<GefsRunComparisonService, "compareRuns">;
}

export class AtmosphericRunComparisonService {
  private readonly gfs: Pick<RunComparisonService, "compareRuns">;
  private readonly gefs: Pick<GefsRunComparisonService, "compareRuns">;

  constructor(options: AtmosphericRunComparisonServiceOptions = {}) {
    this.gfs = options.gfs ?? new RunComparisonService();
    this.gefs = options.gefs ?? new GefsRunComparisonService();
  }

  async compareRuns(request: AtmosphericRunComparisonRequest): Promise<AtmosphericRunComparisonResult> {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.compareRuns(request.query);
      case "gefs_0p50":
        return this.gefs.compareRuns(request.query);
    }
  }
}
