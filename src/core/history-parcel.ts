import { deriveParcelComputation, type ParcelEnvironmentLevel } from "../derived/parcel-diagnostics.js";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../derived/thermodynamics.js";
import {
  historicalParcelQuerySchema,
  type HistoricalParcelQueryInput,
  type HistoricalParcelResult,
} from "../schema/history-parcel.js";
import type { HistoricalFieldsQueryInput, HistoricalFieldsResult } from "../schema/history-fields.js";
import { HistoricalFieldsService } from "./history-fields.js";

const CAVEAT = "Parcel diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

const PARCEL_PRESSURE_VARIABLES = [
  "temperature",
  "specific_humidity",
  "geopotential_height",
] as const;

const PARCEL_HISTORY_FIELDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "temperature_2m",
  "relative_humidity_2m",
] as const;

export interface HistoricalParcelFieldsGetter {
  getHistoricalFields(input: HistoricalFieldsQueryInput): Promise<HistoricalFieldsResult>;
}

export interface HistoricalParcelServiceOptions {
  fieldsGetter?: HistoricalParcelFieldsGetter;
}

export class HistoricalParcelService {
  private readonly fieldsGetter: HistoricalParcelFieldsGetter;

  constructor(options: HistoricalParcelServiceOptions = {}) {
    this.fieldsGetter = options.fieldsGetter ?? new HistoricalFieldsService();
  }

  async getHistoricalParcel(input: HistoricalParcelQueryInput): Promise<HistoricalParcelResult> {
    const query = historicalParcelQuerySchema.parse(input);
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];

    const state = await this.fieldsGetter.getHistoricalFields({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: query.analysisTime,
      variables: [...PARCEL_PRESSURE_VARIABLES],
      pressureLevelsHpa,
      fields: [...PARCEL_HISTORY_FIELDS],
    });

    const levels = state.levels;
    if (!levels) throw new Error("Historical mixed-field result is missing the pressure profile required for parcel diagnostics");

    const surfacePressureHpa = fieldValue(state, "surface_pressure", "pressurePa") / 100;
    const surfaceTemperatureC = fieldValue(state, "temperature_2m", "temperatureC");
    const surfaceRelativeHumidityPct = fieldValue(state, "relative_humidity_2m", "relativeHumidityPct");
    const surface: ParcelEnvironmentLevel = {
      pressureHpa: surfacePressureHpa,
      geopotentialHeightGpm: fieldValue(state, "surface_geopotential_height", "geopotentialHeightGpm"),
      temperatureC: surfaceTemperatureC,
      specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
        surfaceTemperatureC,
        surfaceRelativeHumidityPct,
        surfacePressureHpa,
      ),
    };
    const sampledEnvironment = levels.map((level): ParcelEnvironmentLevel => ({
      pressureHpa: level.pressureHpa,
      geopotentialHeightGpm: required(level.geopotentialHeightGpm, "geopotential_height", level.pressureHpa),
      temperatureC: required(level.temperatureC, "temperature", level.pressureHpa),
      specificHumidityKgKg: required(level.specificHumidityKgKg, "specific_humidity", level.pressureHpa),
    }));
    const parcel = deriveParcelComputation(query.parcel, surface, sampledEnvironment);

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: state.analysisTime,
      requestedPoint: state.requestedPoint,
      gridPoint: state.gridPoint,
      selection: {
        pressureLevelsHpa,
        parcel: query.parcel,
      },
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels,
      parcel,
      source: state.source,
      caveat: CAVEAT,
    };
  }
}

function fieldValue(
  state: HistoricalFieldsResult,
  id: HistoricalFieldsResult["fields"][number]["id"],
  field: string,
): number {
  const result = state.fields.find((candidate) => candidate.id === id);
  const value = result?.values[field];
  if (value === undefined) throw new Error(`Historical parcel state is missing required field ${id}.${field}`);
  return value;
}

function required(value: number | undefined, id: string, pressureHpa: number): number {
  if (value === undefined) throw new Error(`Historical parcel state is missing required ${id}@${pressureHpa}mb`);
  return value;
}
