import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import type { HistoricalGfsVariableId, HistoricalProfileQueryInput } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import {
  historicalLayerDiagnosticsQuerySchema,
  historicalProfileDiagnosticsQuerySchema,
  type HistoricalLayerDiagnosticsQueryInput,
  type HistoricalLayerDiagnosticsResult,
  type HistoricalProfileDiagnosticsQueryInput,
  type HistoricalProfileDiagnosticsResult,
} from "../schema/history-diagnostics.js";
import { deriveLayerDiagnosticsFromLevels, deriveProfileDiagnosticsFromLevels } from "./pressure-diagnostics.js";
import { HistoricalProfileService } from "./history.js";

const CAVEAT = "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalDiagnosticProfileGetter {
  getHistoricalProfile(query: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface HistoricalDiagnosticsServiceOptions {
  profileGetter?: HistoricalDiagnosticProfileGetter;
}

export class HistoricalDiagnosticsService {
  private readonly profileGetter: HistoricalDiagnosticProfileGetter;

  constructor(options: HistoricalDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService();
  }

  async getLayerDiagnostics(
    input: HistoricalLayerDiagnosticsQueryInput,
  ): Promise<HistoricalLayerDiagnosticsResult> {
    const query = historicalLayerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const variables = expandLayerDiagnosticVariables(diagnostics) as HistoricalGfsVariableId[];
    const profile = await this.profileGetter.getHistoricalProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: query.analysisTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
    });
    const derived = deriveLayerDiagnosticsFromLevels(
      profile.levels,
      query.lowerPressureHpa,
      query.upperPressureHpa,
      diagnostics,
    );

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: profile.analysisTime,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      ...derived,
      source: profile.source,
      caveat: CAVEAT,
    };
  }

  async getProfileDiagnostics(
    input: HistoricalProfileDiagnosticsQueryInput,
  ): Promise<HistoricalProfileDiagnosticsResult> {
    const query = historicalProfileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];
    const variables = expandProfileDiagnosticVariables(diagnostics) as HistoricalGfsVariableId[];
    const profile = await this.profileGetter.getHistoricalProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: query.analysisTime,
      variables,
      pressureLevelsHpa,
    });

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: profile.analysisTime,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      diagnostics: deriveProfileDiagnosticsFromLevels(profile.levels, diagnostics),
      source: profile.source,
      caveat: CAVEAT,
    };
  }
}
