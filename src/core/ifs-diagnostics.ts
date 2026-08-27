import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import type { IfsPressureVariableId } from "../catalog/ifs.js";
import {
  ifsLayerDiagnosticsQuerySchema,
  ifsLayerDiagnosticsResultSchema,
  ifsProfileDiagnosticsQuerySchema,
  ifsProfileDiagnosticsResultSchema,
  type IfsLayerDiagnosticsQueryInput,
  type IfsLayerDiagnosticsResult,
  type IfsProfileDiagnosticsQueryInput,
  type IfsProfileDiagnosticsResult,
} from "../schema/ifs-diagnostics.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import { IfsProfileService } from "./ifs-profile.js";
import type { ProfileLevel } from "./types.js";
import {
  deriveLayerDiagnosticsFromLevels,
  deriveProfileDiagnosticsFromLevels,
} from "./pressure-diagnostics.js";

export interface IfsDiagnosticProfileGetter {
  getProfile(query: IfsPointQueryInput): Promise<IfsProfileResult>;
}

export interface IfsDiagnosticsServiceOptions {
  profileGetter?: IfsDiagnosticProfileGetter;
}

export class IfsDiagnosticsService {
  private readonly profileGetter: IfsDiagnosticProfileGetter;

  constructor(options: IfsDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new IfsProfileService();
  }

  async getLayerDiagnostics(
    input: IfsLayerDiagnosticsQueryInput,
  ): Promise<IfsLayerDiagnosticsResult> {
    const query = ifsLayerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const variables = expandLayerDiagnosticVariables(diagnostics) as IfsPressureVariableId[];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
    });
    const levels = profile.levels as ProfileLevel[];
    const derived = deriveLayerDiagnosticsFromLevels(
      levels,
      query.lowerPressureHpa,
      query.upperPressureHpa,
      diagnostics,
    );

    return ifsLayerDiagnosticsResultSchema.parse({
      model: "ifs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      ...derived,
      source: profile.source,
    });
  }

  async getProfileDiagnostics(
    input: IfsProfileDiagnosticsQueryInput,
  ): Promise<IfsProfileDiagnosticsResult> {
    const query = ifsProfileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];
    const variables = expandProfileDiagnosticVariables(diagnostics) as IfsPressureVariableId[];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
    });

    return ifsProfileDiagnosticsResultSchema.parse({
      model: "ifs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      diagnostics: deriveProfileDiagnosticsFromLevels(profile.levels as ProfileLevel[], diagnostics),
      source: profile.source,
    });
  }
}
