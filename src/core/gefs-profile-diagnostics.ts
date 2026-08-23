import type { GefsPressureVariableId } from "../catalog/gefs.js";
import { expandProfileDiagnosticVariables, type ProfileDiagnosticId } from "../catalog/profile-diagnostics.js";
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
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
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
      summaries: diagnostics.map((id) => summarizeDiagnostic(id, derivedMembers, profile.selection.quantiles)),
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

function summarizeDiagnostic(
  id: ProfileDiagnosticId,
  members: readonly DerivedMemberProfile[],
  quantiles: readonly number[],
) {
  switch (id) {
    case "freezing_level_crossings": {
      const samples = members.map((member) => {
        const diagnostic = requiredDiagnostic(member, id);
        if (diagnostic.id !== id) throw new Error("Unexpected GEFS freezing-level diagnostic shape");
        return { member: member.member, crossings: diagnostic.crossings };
      });
      const contributors = samples.filter((sample) => sample.crossings.length > 0);
      return {
        id,
        membersWithAnyCrossing: eventFraction(contributors.length, members.length),
        crossingCount: summarizeNumericDistribution(samples.map((sample) => sample.crossings.length), quantiles),
        ...(contributors.length === 0
          ? {}
          : {
              lowestCrossing: summarizeCrossingSelection(
                contributors.map((sample) => minimumByHeight(sample.crossings)),
                quantiles,
              ),
              highestCrossing: summarizeCrossingSelection(
                contributors.map((sample) => maximumByHeight(sample.crossings)),
                quantiles,
              ),
            }),
      };
    }
    case "temperature_inversion_layers": {
      const samples = members.map((member) => {
        const diagnostic = requiredDiagnostic(member, id);
        if (diagnostic.id !== id) throw new Error("Unexpected GEFS inversion diagnostic shape");
        return { member: member.member, layers: diagnostic.layers };
      });
      const contributors = samples.filter((sample) => sample.layers.length > 0);
      return {
        id,
        membersWithAnyLayer: eventFraction(contributors.length, members.length),
        layerCount: summarizeNumericDistribution(samples.map((sample) => sample.layers.length), quantiles),
        totalLayerDepthGpm: summarizeNumericDistribution(
          samples.map((sample) => sample.layers.reduce((sum, layer) => sum + layer.depthGpm, 0)),
          quantiles,
        ),
        ...(contributors.length === 0
          ? {}
          : {
              deepestLayerDepthGpm: conditionalDistribution(
                contributors.map((sample) => Math.max(...sample.layers.map((layer) => layer.depthGpm))),
                quantiles,
              ),
              strongestTemperatureIncreaseC: conditionalDistribution(
                contributors.map((sample) => Math.max(...sample.layers.map((layer) => layer.temperatureIncreaseC))),
                quantiles,
              ),
              strongestMeanTemperatureGradientCPerKm: conditionalDistribution(
                contributors.map((sample) => Math.max(...sample.layers.map((layer) => layer.meanTemperatureGradientCPerKm))),
                quantiles,
              ),
            }),
      };
    }
  }
}

function requiredDiagnostic(member: DerivedMemberProfile, id: ProfileDiagnosticId): ProfileDiagnosticResult {
  const diagnostic = member.diagnostics.find((candidate) => candidate.id === id);
  if (!diagnostic) throw new Error(`GEFS profile diagnostic aggregation is missing ${id} for ${member.member}`);
  return diagnostic;
}

function eventFraction(count: number, memberCount: number) {
  return {
    count,
    memberCount,
    fraction: count / memberCount,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}

function summarizeCrossingSelection(
  crossings: readonly { geopotentialHeightGpm: number; pressureHpa: number }[],
  quantiles: readonly number[],
) {
  return {
    contributingMemberCount: crossings.length,
    geopotentialHeightGpm: summarizeNumericDistribution(crossings.map((crossing) => crossing.geopotentialHeightGpm), quantiles),
    pressureHpa: summarizeNumericDistribution(crossings.map((crossing) => crossing.pressureHpa), quantiles),
  };
}

function conditionalDistribution(values: readonly number[], quantiles: readonly number[]) {
  return {
    contributingMemberCount: values.length,
    distribution: summarizeNumericDistribution(values, quantiles),
  };
}

function minimumByHeight<T extends { geopotentialHeightGpm: number }>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Cannot select a freezing crossing from an empty list");
  return values.reduce((best, candidate) => candidate.geopotentialHeightGpm < best.geopotentialHeightGpm ? candidate : best, first);
}

function maximumByHeight<T extends { geopotentialHeightGpm: number }>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Cannot select a freezing crossing from an empty list");
  return values.reduce((best, candidate) => candidate.geopotentialHeightGpm > best.geopotentialHeightGpm ? candidate : best, first);
}
