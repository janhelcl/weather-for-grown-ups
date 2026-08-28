import { type GefsPressureVariableId } from "../catalog/gefs.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import {
  gefsLayerDiagnosticsQuerySchema,
  gefsLayerDiagnosticsResultSchema,
  type GefsLayerDiagnosticsQueryInput,
  type GefsLayerDiagnosticsResult,
} from "../schema/gefs-layer-diagnostics.js";
import type {
  GefsEnsembleProfileQueryInput,
  GefsEnsembleProfileResult,
} from "../schema/gefs-ensemble-profile.js";
import { fromGefsMemberProfiles } from "./atmospheric-profile.js";
import { summarizeEnsembleLayerDiagnostics } from "./ensemble-diagnostic-summaries.js";
import { GefsEnsembleProfileService } from "./gefs-ensemble-profile.js";
import { deriveLayerDiagnosticsFromLevels } from "./pressure-diagnostics.js";

export interface GefsLayerProfileGetter {
  getProfile(query: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult>;
}

export interface GefsLayerDiagnosticsServiceOptions {
  profileGetter?: GefsLayerProfileGetter;
}

export class GefsLayerDiagnosticsService {
  private readonly profileGetter: GefsLayerProfileGetter;

  constructor(options: GefsLayerDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new GefsEnsembleProfileService();
  }

  async getLayerDiagnostics(input: GefsLayerDiagnosticsQueryInput): Promise<GefsLayerDiagnosticsResult> {
    const query = gefsLayerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const variables = expandLayerDiagnosticVariables(diagnostics) as GefsPressureVariableId[];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
      members: query.members,
      quantiles: query.quantiles,
      includeMembers: true,
    });
    const memberProfiles = fromGefsMemberProfiles(profile);
    const cacheByMember = new Map((profile.members ?? []).map((sample) => [sample.member, sample.cacheHit]));
    const derivedMembers = memberProfiles.map((memberProfile) => {
      if (!memberProfile.member) throw new Error("GEFS layer diagnostic member profile is missing member identity");
      const derived = deriveLayerDiagnosticsFromLevels(
        memberProfile.levels,
        query.lowerPressureHpa,
        query.upperPressureHpa,
        diagnostics,
      );
      return {
        member: memberProfile.member,
        cacheHit: cacheByMember.get(memberProfile.member) ?? false,
        ...derived,
      };
    });

    const aggregate = summarizeEnsembleLayerDiagnostics(
      diagnostics,
      derivedMembers,
      profile.selection.quantiles,
    );

    return gefsLayerDiagnosticsResultSchema.parse({
      model: "gefs_0p50",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      pressureLayer: {
        lowerPressureHpa: query.lowerPressureHpa,
        upperPressureHpa: query.upperPressureHpa,
      },
      selection: {
        diagnostics,
        members: profile.selection.members,
        quantiles: profile.selection.quantiles,
      },
      layerDepthGpm: aggregate.layerDepthGpm,
      summaries: aggregate.summaries,
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, cacheHit, layer, diagnostics: memberDiagnostics }) => ({
              member,
              cacheHit,
              layer,
              diagnostics: memberDiagnostics,
            })),
          }
        : {}),
      source: profile.source,
    });
  }
}
