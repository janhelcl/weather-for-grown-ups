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
import type { ProfileDiagnosticsQueryInput } from "../schema/query.js";
import type { ProfileDiagnosticsResult } from "./types.js";
import { GefsProfileDiagnosticsService } from "./gefs-profile-diagnostics.js";
import { ProfileDiagnosticsService } from "./profile-diagnostics.js";

export interface DeterministicProfileDiagnosticsGetter {
  getProfileDiagnostics(query: ProfileDiagnosticsQueryInput): Promise<ProfileDiagnosticsResult>;
}

export interface EnsembleProfileDiagnosticsGetter {
  getProfileDiagnostics(query: GefsProfileDiagnosticsQueryInput): Promise<GefsProfileDiagnosticsResult>;
}

export interface AtmosphericProfileDiagnosticsServiceOptions {
  gfs?: DeterministicProfileDiagnosticsGetter;
  gefs?: EnsembleProfileDiagnosticsGetter;
}

export class AtmosphericProfileDiagnosticsService {
  private readonly gfs: DeterministicProfileDiagnosticsGetter;
  private readonly gefs: EnsembleProfileDiagnosticsGetter;

  constructor(options: AtmosphericProfileDiagnosticsServiceOptions = {}) {
    this.gfs = options.gfs ?? new ProfileDiagnosticsService();
    this.gefs = options.gefs ?? new GefsProfileDiagnosticsService();
  }

  async getProfileDiagnostics(input: AtmosphericProfileDiagnosticsRequestInput): Promise<AtmosphericProfileDiagnosticsResult> {
    const request = atmosphericProfileDiagnosticsRequestSchema.parse(input);
    const result = request.model === "gfs_0p25"
      ? await this.gfs.getProfileDiagnostics(request.query)
      : await this.gefs.getProfileDiagnostics(request.query);
    return atmosphericProfileDiagnosticsResultSchema.parse(result);
  }
}
