import {
  expandLayerDiagnosticVariables,
  type LayerDiagnosticId,
} from "../catalog/layer-diagnostics.js";
import {
  deriveLayerDepthGpm,
  derivePotentialTemperatureGradientKPerKm,
  deriveTemperatureLapseRateCPerKm,
  deriveWindShear,
} from "../derived/layer-diagnostics.js";
import {
  layerDiagnosticsQuerySchema,
  type LayerDiagnosticsQueryInput,
  type ProfileQueryInput,
} from "../schema/query.js";
import { ProfileService } from "./profile.js";
import type {
  LayerDiagnosticResult,
  LayerDiagnosticsResult,
  ProfileLevel,
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
      validTime: query.validTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
      source: query.source,
    });

    const lower = requiredLevel(profile.levels, query.lowerPressureHpa);
    const upper = requiredLevel(profile.levels, query.upperPressureHpa);
    const lowerHeightGpm = required(lower.geopotentialHeightGpm, "geopotential_height", lower.pressureHpa);
    const upperHeightGpm = required(upper.geopotentialHeightGpm, "geopotential_height", upper.pressureHpa);
    const depthGpm = deriveLayerDepthGpm(lowerHeightGpm, upperHeightGpm);

    return {
      model: "gfs_0p25",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      layer: {
        lowerPressureHpa: query.lowerPressureHpa,
        upperPressureHpa: query.upperPressureHpa,
        lowerGeopotentialHeightGpm: lowerHeightGpm,
        upperGeopotentialHeightGpm: upperHeightGpm,
        depthGpm,
      },
      levels: [lower, upper],
      diagnostics: diagnostics.map((id) => deriveDiagnostic(id, lower, upper, lowerHeightGpm, upperHeightGpm)),
      source: profile.source,
    };
  }
}

function deriveDiagnostic(
  id: LayerDiagnosticId,
  lower: ProfileLevel,
  upper: ProfileLevel,
  lowerHeightGpm: number,
  upperHeightGpm: number,
): LayerDiagnosticResult {
  switch (id) {
    case "temperature_lapse_rate":
      return {
        id,
        values: {
          temperatureLapseRateCPerKm: deriveTemperatureLapseRateCPerKm(
            required(lower.temperatureC, "temperature", lower.pressureHpa),
            required(upper.temperatureC, "temperature", upper.pressureHpa),
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
    case "wind_shear":
      return {
        id,
        values: {
          ...deriveWindShear(
            required(lower.uWindMs, "u_wind", lower.pressureHpa),
            required(lower.vWindMs, "v_wind", lower.pressureHpa),
            required(upper.uWindMs, "u_wind", upper.pressureHpa),
            required(upper.vWindMs, "v_wind", upper.pressureHpa),
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
    case "potential_temperature_gradient":
      return {
        id,
        values: {
          potentialTemperatureGradientKPerKm: derivePotentialTemperatureGradientKPerKm(
            required(lower.temperatureC, "temperature", lower.pressureHpa),
            lower.pressureHpa,
            required(upper.temperatureC, "temperature", upper.pressureHpa),
            upper.pressureHpa,
            lowerHeightGpm,
            upperHeightGpm,
          ),
        },
      };
  }
}

function requiredLevel(levels: ProfileLevel[], pressureHpa: number): ProfileLevel {
  const level = levels.find((candidate) => candidate.pressureHpa === pressureHpa);
  if (!level) throw new Error(`Profile result is missing required pressure level ${pressureHpa} hPa`);
  return level;
}

function required(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`Profile result is missing required ${id}@${pressureHpa}mb`);
  return value;
}
