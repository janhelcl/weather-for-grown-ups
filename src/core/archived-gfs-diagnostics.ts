import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../derived/parcel-diagnostics.js";
import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../schema/unified-api.js";
import type { NonIsobaricFieldResult, ProfileLevel } from "./types.js";
import {
  ARCHIVED_GFS_FORECAST_MODEL,
  ArchivedGfsForecastQueryService,
  archivedGfsForecastHoursInRange,
} from "./archived-gfs-query.js";
import { parseGfsRun, validTimeForForecastHour } from "./forecast-hour.js";
import {
  deriveLayerDiagnosticsFromLevels,
  deriveProfileDiagnosticsFromLevels,
} from "./pressure-diagnostics.js";

const ARCHIVE_DIAGNOSTIC_CAVEAT =
  "Diagnostics are derived from archived GFS Grid 4 forecasts; model versions changed over time and this is not a homogeneous reforecast dataset" as const;

interface ArchivedPointState {
  model: typeof ARCHIVED_GFS_FORECAST_MODEL;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: { latitude: number; longitude: number };
  gridPoint: { latitude: number; longitude: number };
  levels?: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
  source: {
    provider: "NOAA NCEI";
    access: "ncei_thredds_ncss";
    dataset: string;
    cacheHit: boolean;
  };
}

export interface ArchivedGfsForecastDiagnosticServiceOptions {
  state?: Pick<ArchivedGfsForecastQueryService, "query">;
}

export class ArchivedGfsForecastDiagnosticService {
  private readonly state: Pick<ArchivedGfsForecastQueryService, "query">;

  constructor(options: ArchivedGfsForecastDiagnosticServiceOptions = {}) {
    this.state = options.state ?? new ArchivedGfsForecastQueryService();
  }

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") {
      throw new Error("Archived GFS forecast diagnostics only accept dataset=gfs");
    }
    const selector = request.forecast?.run;
    if (selector === undefined || selector === "latest" || selector === "latest_complete") {
      throw new Error("Archived GFS forecast diagnostics require an explicit forecast.run cycle");
    }
    if (request.source !== undefined) {
      throw new Error("source override is only available for operational GFS; archived forecasts use NOAA NCEI");
    }
    const run = parseGfsRun(selector);
    return "at" in request.time
      ? this.instant(request, run, request.time.at)
      : this.range(request, run);
  }

  private async instant(
    request: DiagnoseAtmosphereRequest,
    run: Date,
    validTime: string,
  ): Promise<unknown> {
    const diagnostic = request.diagnostic;
    if (diagnostic.kind === "layer") {
      const variables = expandLayerDiagnosticVariables(diagnostic.diagnostics);
      const state = await this.pointState(request, validTime, {
        variables,
        pressureLevelsHpa: [diagnostic.lowerPressureHpa, diagnostic.upperPressureHpa],
      });
      const levels = requiredLevels(state);
      return {
        model: ARCHIVED_GFS_FORECAST_MODEL,
        run: state.run,
        validTime: state.validTime,
        forecastHour: state.forecastHour,
        requestedPoint: state.requestedPoint,
        gridPoint: state.gridPoint,
        ...deriveLayerDiagnosticsFromLevels(
          levels,
          diagnostic.lowerPressureHpa,
          diagnostic.upperPressureHpa,
          diagnostic.diagnostics,
        ),
        source: state.source,
        caveat: ARCHIVE_DIAGNOSTIC_CAVEAT,
      };
    }

    if (diagnostic.kind === "profile") {
      const variables = expandProfileDiagnosticVariables(diagnostic.diagnostics);
      const pressureLevelsHpa = [...new Set(diagnostic.pressureLevelsHpa)];
      const state = await this.pointState(request, validTime, {
        variables,
        pressureLevelsHpa,
      });
      const levels = requiredLevels(state);
      return {
        model: ARCHIVED_GFS_FORECAST_MODEL,
        run: state.run,
        validTime: state.validTime,
        forecastHour: state.forecastHour,
        requestedPoint: state.requestedPoint,
        gridPoint: state.gridPoint,
        sampledPressureLevelsHpa: pressureLevelsHpa,
        levels,
        diagnostics: deriveProfileDiagnosticsFromLevels(levels, diagnostic.diagnostics),
        source: state.source,
        caveat: ARCHIVE_DIAGNOSTIC_CAVEAT,
      };
    }

    const definition = PARCEL_DIAGNOSTIC_CATALOG[diagnostic.parcel];
    const pressureLevelsHpa = [...new Set(diagnostic.pressureLevelsHpa)];
    const state = await this.pointState(request, validTime, {
      variables: [...definition.pressureDependencies],
      pressureLevelsHpa,
      fields: [...definition.fieldDependencies],
    });
    const levels = requiredLevels(state);
    const fields = requiredFields(state);
    const surface: ParcelEnvironmentLevel = {
      pressureHpa: fieldValue(fields, "surface_pressure", "pressurePa") / 100,
      geopotentialHeightGpm: fieldValue(
        fields,
        "surface_geopotential_height",
        "geopotentialHeightGpm",
      ),
      temperatureC: fieldValue(fields, "temperature_2m", "temperatureC"),
      specificHumidityKgKg: fieldValue(
        fields,
        "specific_humidity_2m",
        "specificHumidityKgKg",
      ),
    };
    const environment = levels.map((level): ParcelEnvironmentLevel => ({
      pressureHpa: level.pressureHpa,
      geopotentialHeightGpm: requiredValue(
        level.geopotentialHeightGpm,
        "geopotential_height",
        level.pressureHpa,
      ),
      temperatureC: requiredValue(level.temperatureC, "temperature", level.pressureHpa),
      specificHumidityKgKg: requiredValue(
        level.specificHumidityKgKg,
        "specific_humidity",
        level.pressureHpa,
      ),
    }));
    const parcel = deriveParcelComputation(diagnostic.parcel, surface, environment);

    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: state.run,
      validTime: state.validTime,
      forecastHour: state.forecastHour,
      requestedPoint: state.requestedPoint,
      gridPoint: state.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      levels,
      parcel,
      source: state.source,
      caveat: ARCHIVE_DIAGNOSTIC_CAVEAT,
    };
  }

  private async range(
    request: DiagnoseAtmosphereRequest,
    run: Date,
  ): Promise<unknown> {
    if (!("from" in request.time)) {
      throw new Error("Internal archive diagnostic routing error: expected range");
    }
    const startTime = new Date(request.time.from);
    const endTime = new Date(request.time.to);
    const forecastHours = archivedGfsForecastHoursInRange(run, startTime, endTime);
    const maxSteps = request.time.maxSteps ?? 65;
    if (forecastHours.length > maxSteps) {
      throw new Error(
        `Requested archived GFS diagnostic range contains ${forecastHours.length} native 3-hour outputs, exceeding maxSteps=${maxSteps}`,
      );
    }

    const series: any[] = [];
    let first: any;
    for (const forecastHour of forecastHours) {
      const validTime = validTimeForForecastHour(run, forecastHour).toISOString();
      const result: any = await this.instant(request, run, validTime);
      first ??= result;
      if (
        result.gridPoint.latitude !== first.gridPoint.latitude
        || result.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("Archived GFS grid point changed within one diagnostic time-series query");
      }
      series.push(compactStep(result, request.diagnostic.kind));
    }

    return {
      model: ARCHIVED_GFS_FORECAST_MODEL,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: {
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
      },
      gridPoint: first.gridPoint,
      diagnostic: request.diagnostic,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "serial_native_forecast_steps",
      },
      series,
      caveat: ARCHIVE_DIAGNOSTIC_CAVEAT,
    };
  }

  private async pointState(
    request: DiagnoseAtmosphereRequest,
    validTime: string,
    selection: QueryAtmosphereRequest["selection"],
  ): Promise<ArchivedPointState> {
    const result = await this.state.query({
      dataset: "gfs",
      geometry: {
        type: "point",
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
      },
      time: { at: validTime },
      selection,
      forecast: { run: request.forecast!.run },
    } as QueryAtmosphereRequest);
    if (
      typeof result !== "object"
      || result === null
      || !("model" in result)
      || (result as { model?: unknown }).model !== ARCHIVED_GFS_FORECAST_MODEL
    ) {
      throw new Error("Archived GFS diagnostic state query returned an unexpected result");
    }
    return result as ArchivedPointState;
  }
}

function requiredLevels(state: ArchivedPointState): ProfileLevel[] {
  if (state.levels === undefined) {
    throw new Error("Archived GFS diagnostic state is missing required pressure levels");
  }
  return state.levels;
}

function requiredFields(state: ArchivedPointState): NonIsobaricFieldResult[] {
  if (state.fields === undefined) {
    throw new Error("Archived GFS parcel state is missing required surface fields");
  }
  return state.fields;
}

function fieldValue(
  fields: readonly NonIsobaricFieldResult[],
  id: NonIsobaricFieldResult["id"],
  field: string,
): number {
  const candidate = fields.find((item) => item.id === id);
  const value = candidate?.values[field];
  if (value === undefined) {
    throw new Error(`Archived GFS parcel state is missing required field ${id}.${field}`);
  }
  return value;
}

function requiredValue(
  value: number | undefined,
  id: string,
  pressureHpa: number,
): number {
  if (value === undefined) {
    throw new Error(`Archived GFS parcel state is missing required ${id}@${pressureHpa}mb`);
  }
  return value;
}

function compactStep(result: any, kind: DiagnoseAtmosphereRequest["diagnostic"]["kind"]) {
  if (kind === "layer") {
    return {
      kind,
      validTime: result.validTime,
      forecastHour: result.forecastHour,
      layer: result.layer,
      diagnostics: result.diagnostics,
      dataset: result.source.dataset,
      cacheHit: result.source.cacheHit,
    };
  }
  if (kind === "profile") {
    return {
      kind,
      validTime: result.validTime,
      forecastHour: result.forecastHour,
      diagnostics: result.diagnostics,
      dataset: result.source.dataset,
      cacheHit: result.source.cacheHit,
    };
  }
  const { parcelPath: _parcelPath, ...parcel } = result.parcel;
  return {
    kind,
    validTime: result.validTime,
    forecastHour: result.forecastHour,
    parcel,
    dataset: result.source.dataset,
    cacheHit: result.source.cacheHit,
  };
}
