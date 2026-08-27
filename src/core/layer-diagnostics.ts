import {
  expandLayerDiagnosticVariables,
} from "../catalog/layer-diagnostics.js";
import {
  layerDiagnosticsQuerySchema,
  type LayerDiagnosticsQueryInput,
  type ProfileQueryInput,
} from "../schema/query.js";
import { deriveLayerDiagnosticsFromLevels } from "./pressure-diagnostics.js";
import { ProfileService } from "./profile.js";
import type {
  LayerDiagnosticsResult,
  ProfileResult,
} from "./types.js";

export interface LayerProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface LayerDiagnosticsServiceOptions {
  profileGetter?: LayerProfileGetter;
}

export class LayerDiagnosticsService {
  private readonly profileGetter: LayerProfileGetter;

  constructor(options: LayerDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new ProfileService();
  }

  async getLayerDiagnostics(input: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult> {
    const query = layerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const variables = expandLayerDiagnosticVariables(diagnostics);

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      grid: query.grid,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
      source: query.source,
    });
    const derived = deriveLayerDiagnosticsFromLevels(
      profile.levels,
      query.lowerPressureHpa,
      query.upperPressureHpa,
      diagnostics,
    );

    return {
      model: profile.model,
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      ...derived,
      source: profile.source,
    };
  }
}
