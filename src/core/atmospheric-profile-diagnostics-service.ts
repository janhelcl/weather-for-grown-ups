import {
  atmosphericProfileDiagnosticsRequestSchema,
  atmosphericProfileDiagnosticsResultSchema,
  type AtmosphericProfileDiagnosticsRequestInput,
  type AtmosphericProfileDiagnosticsResult,
} from "../schema/atmospheric-profile-diagnostics.js";
import type {
  GefsProfileDiagnosticsQueryInput,
  GefsProfileDiagnosticsResult,
} from "../schema/gefs-profile-diagnostics.js";
import type {
  HistoricalProfileDiagnosticsQueryInput,
  HistoricalProfileDiagnosticsResult,
} from "../schema/history-diagnostics.js";
import type { ProfileDiagnosticsQueryInput } from "../schema/query.js";
import type { ProfileDiagnosticsResult } from "./types.js";
import { GefsProfileDiagnosticsService } from "./gefs-profile-diagnostics.js";
import { HistoricalDiagnosticsService } from "./history-diagnostics.js";
import { ProfileDiagnosticsService } from "./profile-diagnostics.js";

export interface DeterministicProfileDiagnosticsGetter {
  getProfileDiagnostics(query: ProfileDiagnosticsQueryInput): Promise<ProfileDiagnosticsResult>;
}

export interface EnsembleProfileDiagnosticsGetter {
  getProfileDiagnostics(query: GefsProfileDiagnosticsQueryInput): Promise<GefsProfileDiagnosticsResult>;
}

export interface HistoricalProfileDiagnosticsGetter {
  getProfileDiagnostics(query: HistoricalProfileDiagnosticsQueryInput): Promise<HistoricalProfileDiagnosticsResult>;
}

export interface AtmosphericProfileDiagnosticsServiceOptions {
  gfs?: DeterministicProfileDiagnosticsGetter;
  gefs?: EnsembleProfileDiagnosticsGetter;
  history?: HistoricalProfileDiagnosticsGetter;
}

export class AtmosphericProfileDiagnosticsService {
  private readonly gfs: DeterministicProfileDiagnosticsGetter;
  private readonly gefs: EnsembleProfileDiagnosticsGetter;
  private readonly history: HistoricalProfileDiagnosticsGetter;

  constructor(options: AtmosphericProfileDiagnosticsServiceOptions = {}) {
    this.gfs = options.gfs ?? new ProfileDiagnosticsService();
    this.gefs = options.gefs ?? new GefsProfileDiagnosticsService();
    this.history = options.history ?? new HistoricalDiagnosticsService();
  }

  async getProfileDiagnostics(input: AtmosphericProfileDiagnosticsRequestInput): Promise<AtmosphericProfileDiagnosticsResult> {
    const request = atmosphericProfileDiagnosticsRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericProfileDiagnosticsResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericProfileDiagnosticsRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getProfileDiagnostics(request.query);
      case "gfs_0p50":
        return this.gfs.getProfileDiagnostics({ ...request.query, grid: "0p50" });
      case "gefs_0p50":
        return this.gefs.getProfileDiagnostics(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getProfileDiagnostics(request.query);
    }
  }
}
