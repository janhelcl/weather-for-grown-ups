import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import type { IfsFieldId, IfsPressureVariableId } from "../catalog/ifs.js";
import {
  ifsLayerDiagnosticsQuerySchema,
  ifsLayerDiagnosticsResultSchema,
  ifsProfileDiagnosticsQuerySchema,
  ifsProfileDiagnosticsResultSchema,
  ifsParcelDiagnosticsQuerySchema,
  ifsParcelDiagnosticsResultSchema,
  type IfsLayerDiagnosticsQueryInput,
  type IfsLayerDiagnosticsResult,
  type IfsProfileDiagnosticsQueryInput,
  type IfsProfileDiagnosticsResult,
  type IfsParcelDiagnosticsQueryInput,
  type IfsParcelDiagnosticsResult,
} from "../schema/ifs-diagnostics.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import { IfsProfileService } from "./ifs-profile.js";
import { deriveParcelComputation } from "../derived/parcel-diagnostics.js";
import { parcelEnvironmentLevel, parcelSurfaceEnvironment } from "./parcel-diagnostics.js";
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

  async getParcelDiagnostics(
    input: IfsParcelDiagnosticsQueryInput,
  ): Promise<IfsParcelDiagnosticsResult> {
    const query = ifsParcelDiagnosticsQuerySchema.parse(input);
    const definition = PARCEL_DIAGNOSTIC_CATALOG[query.parcel];
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables: [...definition.pressureDependencies] as IfsPressureVariableId[],
      pressureLevelsHpa,
      fields: [...definition.fieldDependencies] as IfsFieldId[],
    });

    return ifsParcelDiagnosticsResultSchema.parse({
      model: "ifs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      parcel: deriveParcelComputation(
        query.parcel,
        parcelSurfaceEnvironment(profile.fields ?? []),
        (profile.levels as ProfileLevel[]).map(parcelEnvironmentLevel),
      ),
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
