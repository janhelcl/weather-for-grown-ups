import {
  atmosphericProfileRequestSchema,
  atmosphericProfileResultSchema,
  type AtmosphericProfileRequestInput,
  type AtmosphericProfileResult,
} from "../schema/atmospheric-profile.js";
import type { GefsEnsembleProfileQueryInput, GefsEnsembleProfileResult } from "../schema/gefs-ensemble-profile.js";
import type { ProfileQueryInput } from "../schema/query.js";
import type { ProfileResult } from "./types.js";
import { GefsEnsembleProfileService } from "./gefs-ensemble-profile.js";
import { ProfileService } from "./profile.js";

export interface DeterministicProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface EnsembleProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export interface AtmosphericProfileServiceOptions {
  gfs?: DeterministicProfileGetter;
  gefs?: EnsembleProfileGetter;
}

export class AtmosphericProfileService {
  private readonly gfs: DeterministicProfileGetter;
  private readonly gefs: EnsembleProfileGetter;

  constructor(options: AtmosphericProfileServiceOptions = {}) {
    this.gfs = options.gfs ?? new ProfileService();
    this.gefs = options.gefs ?? new GefsEnsembleProfileService();
  }

  async getProfile(input: AtmosphericProfileRequestInput): Promise<AtmosphericProfileResult> {
    const request = atmosphericProfileRequestSchema.parse(input);
    const result = request.model === "gfs_0p25"
      ? await this.gfs.getProfile(request.query)
      : await this.gefs.getProfile(request.query);
    return atmosphericProfileResultSchema.parse(result);
  }
}
