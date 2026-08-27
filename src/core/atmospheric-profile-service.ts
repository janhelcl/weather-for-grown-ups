import {
  atmosphericProfileRequestSchema,
  atmosphericProfileResultSchema,
  type AtmosphericProfileRequestInput,
  type AtmosphericProfileResult,
} from "../schema/atmospheric-profile.js";
import type { GefsEnsembleProfileQueryInput, GefsEnsembleProfileResult } from "../schema/gefs-ensemble-profile.js";
import type { HistoricalProfileQueryInput } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import type { ProfileQueryInput } from "../schema/query.js";
import type { ProfileResult } from "./types.js";
import { GefsEnsembleProfileService } from "./gefs-ensemble-profile.js";
import { HistoricalProfileService } from "./history.js";
import { ProfileService } from "./profile.js";

export interface DeterministicProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface EnsembleProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export interface HistoricalProfileGetter {
  getHistoricalProfile(query: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface AtmosphericProfileServiceOptions {
  gfs?: DeterministicProfileGetter;
  gefs?: EnsembleProfileGetter;
  history?: HistoricalProfileGetter;
}

export class AtmosphericProfileService {
  private readonly gfs: DeterministicProfileGetter;
  private readonly gefs: EnsembleProfileGetter;
  private readonly history: HistoricalProfileGetter;

  constructor(options: AtmosphericProfileServiceOptions = {}) {
    this.gfs = options.gfs ?? new ProfileService();
    this.gefs = options.gefs ?? new GefsEnsembleProfileService();
    this.history = options.history ?? new HistoricalProfileService();
  }

  async getProfile(input: AtmosphericProfileRequestInput): Promise<AtmosphericProfileResult> {
    const request = atmosphericProfileRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericProfileResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericProfileRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getProfile(request.query);
      case "gfs_0p50":
        return this.gfs.getProfile({ ...request.query, grid: "0p50" });
      case "gefs_0p50":
        return this.gefs.getProfile(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getHistoricalProfile(request.query);
    }
  }
}
