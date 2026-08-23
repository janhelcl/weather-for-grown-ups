import {
  expandProfileDiagnosticVariables,
} from "../catalog/profile-diagnostics.js";
import {
  profileDiagnosticsQuerySchema,
  type ProfileDiagnosticsQueryInput,
  type ProfileQueryInput,
} from "../schema/query.js";
import { deriveProfileDiagnosticsFromLevels } from "./pressure-diagnostics.js";
import { ProfileService } from "./profile.js";
import type {
  ProfileDiagnosticsResult,
  ProfileResult,
} from "./types.js";

export interface DiagnosticProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface ProfileDiagnosticsServiceOptions {
  profileGetter?: DiagnosticProfileGetter;
}

export class ProfileDiagnosticsService {
  private readonly profileGetter: DiagnosticProfileGetter;

  constructor(options: ProfileDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new ProfileService();
  }

  async getProfileDiagnostics(input: ProfileDiagnosticsQueryInput): Promise<ProfileDiagnosticsResult> {
    const query = profileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];
    const variables = expandProfileDiagnosticVariables(diagnostics);

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
      source: query.source,
    });

    return {
      model: "gfs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      diagnostics: deriveProfileDiagnosticsFromLevels(profile.levels, diagnostics),
      source: profile.source,
    };
  }
}
