import {
  expandProfileDiagnosticVariables,
  type ProfileDiagnosticId,
} from "../catalog/profile-diagnostics.js";
import {
  deriveFreezingLevelCrossings,
  deriveTemperatureInversionLayers,
  type SampledThermodynamicLevel,
} from "../derived/profile-diagnostics.js";
import {
  profileDiagnosticsQuerySchema,
  type ProfileDiagnosticsQueryInput,
  type ProfileQueryInput,
} from "../schema/query.js";
import { ProfileService } from "./profile.js";
import type {
  ProfileDiagnosticResult,
  ProfileDiagnosticsResult,
  ProfileLevel,
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

    const sampledLevels = profile.levels.map(toSampledLevel);

    return {
      model: "gfs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      diagnostics: diagnostics.map((id) => deriveDiagnostic(id, sampledLevels)),
      source: profile.source,
    };
  }
}

function deriveDiagnostic(
  id: ProfileDiagnosticId,
  levels: readonly SampledThermodynamicLevel[],
): ProfileDiagnosticResult {
  switch (id) {
    case "freezing_level_crossings":
      return { id, crossings: deriveFreezingLevelCrossings(levels) };
    case "temperature_inversion_layers":
      return { id, layers: deriveTemperatureInversionLayers(levels) };
  }
}

function toSampledLevel(level: ProfileLevel): SampledThermodynamicLevel {
  return {
    pressureHpa: level.pressureHpa,
    temperatureC: required(level.temperatureC, "temperature", level.pressureHpa),
    geopotentialHeightGpm: required(level.geopotentialHeightGpm, "geopotential_height", level.pressureHpa),
  };
}

function required(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`Profile result is missing required ${id}@${pressureHpa}mb`);
  return value;
}
