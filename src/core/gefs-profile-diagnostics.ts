import type { GefsPressureVariableId } from "../catalog/gefs.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import type {
  GefsEnsembleProfileQueryInput,
  GefsEnsembleProfileResult,
} from "../schema/gefs-ensemble-profile.js";
import {
  gefsProfileDiagnosticsQuerySchema,
  gefsProfileDiagnosticsResultSchema,
  type GefsProfileDiagnosticsQueryInput,
  type GefsProfileDiagnosticsResult,
} from "../schema/gefs-profile-diagnostics.js";
import { fromGefsMemberProfiles } from "./atmospheric-profile.js";
import { summarizeEnsembleProfileDiagnostics } from "./ensemble-diagnostic-summaries.js";
import { GefsEnsembleProfileService } from "./gefs-ensemble-profile.js";
import { deriveProfileDiagnosticsFromLevels } from "./pressure-diagnostics.js";
import type { ProfileDiagnosticResult, ProfileLevel } from "./types.js";

export interface GefsProfileDiagnosticsProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export interface GefsProfileDiagnosticsServiceOptions {
  profileGetter?: GefsProfileDiagnosticsProfileGetter;
}

interface DerivedMemberProfile {
  member: string;
  cacheHit: boolean;
  levels: ProfileLevel[];
  diagnostics: ProfileDiagnosticResult[];
}

export class GefsProfileDiagnosticsService {
  private readonly profileGetter: GefsProfileDiagnosticsProfileGetter;

  constructor(options: GefsProfileDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new GefsEnsembleProfileService();
  }

  async getProfileDiagnostics(input: GefsProfileDiagnosticsQueryInput): Promise<GefsProfileDiagnosticsResult> {
    const query = gefsProfileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const variables = expandProfileDiagnosticVariables(diagnostics) as GefsPressureVariableId[];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
      members: query.members,
      quantiles: query.quantiles,
      includeMembers: true,
    });
    const cacheByMember = new Map((profile.members ?? []).map((sample) => [sample.member, sample.cacheHit]));
    const derivedMembers: DerivedMemberProfile[] = fromGefsMemberProfiles(profile).map((memberProfile) => {
      if (!memberProfile.member) throw new Error("GEFS profile diagnostic member profile is missing member identity");
      return {
        member: memberProfile.member,
        cacheHit: cacheByMember.get(memberProfile.member) ?? false,
        levels: memberProfile.levels,
        diagnostics: deriveProfileDiagnosticsFromLevels(memberProfile.levels, diagnostics),
      };
    });

    return gefsProfileDiagnosticsResultSchema.parse({
      model: "gefs_0p50",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: {
        diagnostics,
        members: profile.selection.members,
        quantiles: profile.selection.quantiles,
      },
      summaries: summarizeEnsembleProfileDiagnostics(
        diagnostics,
        derivedMembers,
        profile.selection.quantiles,
      ),
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, cacheHit, levels, diagnostics: memberDiagnostics }) => ({
              member,
              cacheHit,
              levels,
              diagnostics: memberDiagnostics,
            })),
          }
        : {}),
      source: profile.source,
    });
  }
}

