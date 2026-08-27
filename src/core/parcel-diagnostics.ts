import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../derived/parcel-diagnostics.js";
import {
  parcelDiagnosticsQuerySchema,
  type ParcelDiagnosticsQueryInput,
  type ProfileQueryInput,
} from "../schema/query.js";
import { ProfileService } from "./profile.js";
import type {
  NonIsobaricFieldResult,
  ParcelDiagnosticsResult,
  ProfileLevel,
  ProfileResult,
} from "./types.js";

export interface ParcelProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface ParcelDiagnosticsServiceOptions {
  profileGetter?: ParcelProfileGetter;
}

export class ParcelDiagnosticsService {
  private readonly profileGetter: ParcelProfileGetter;

  constructor(options: ParcelDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new ProfileService();
  }

  async getParcelDiagnostics(input: ParcelDiagnosticsQueryInput): Promise<ParcelDiagnosticsResult> {
    const query = parcelDiagnosticsQuerySchema.parse(input);
    const definition = PARCEL_DIAGNOSTIC_CATALOG[query.parcel];
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      grid: query.grid,
      validTime: query.validTime,
      variables: [...definition.pressureDependencies],
      pressureLevelsHpa,
      fields: [...definition.fieldDependencies],
      source: query.source,
    });

    const surface = surfaceEnvironment(profile.fields ?? []);
    const sampledEnvironment = profile.levels.map(toEnvironmentLevel);
    const parcel = deriveParcelComputation(query.parcel, surface, sampledEnvironment);

    return {
      model: profile.model,
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels: profile.levels,
      parcel,
      source: profile.source,
    };
  }
}

function surfaceEnvironment(fields: readonly NonIsobaricFieldResult[]): ParcelEnvironmentLevel {
  return {
    pressureHpa: fieldValue(fields, "surface_pressure", "pressurePa") / 100,
    geopotentialHeightGpm: fieldValue(fields, "surface_geopotential_height", "geopotentialHeightGpm"),
    temperatureC: fieldValue(fields, "temperature_2m", "temperatureC"),
    specificHumidityKgKg: fieldValue(fields, "specific_humidity_2m", "specificHumidityKgKg"),
  };
}

function fieldValue(
  fields: readonly NonIsobaricFieldResult[],
  id: NonIsobaricFieldResult["id"],
  field: string,
): number {
  const result = fields.find((candidate) => candidate.id === id);
  const value = result?.values[field];
  if (value === undefined) throw new Error(`Profile result is missing required parcel field ${id}.${field}`);
  return value;
}

function toEnvironmentLevel(level: ProfileLevel): ParcelEnvironmentLevel {
  return {
    pressureHpa: level.pressureHpa,
    geopotentialHeightGpm: required(level.geopotentialHeightGpm, "geopotential_height", level.pressureHpa),
    temperatureC: required(level.temperatureC, "temperature", level.pressureHpa),
    specificHumidityKgKg: required(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
  };
}

function required(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`Profile result is missing required ${id}@${pressureHpa}mb`);
  return value;
}
