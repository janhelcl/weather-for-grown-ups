import {
  igraForecastVerificationQuerySchema,
  igraForecastVerificationResultSchema,
  type IgraForecastVerificationQueryInput,
  type IgraForecastVerificationResult,
} from "../schema/igra-verification.js";
import { RDA_GFS_0P25_FORECAST_START } from "../sources/rda-gfs-forecast-history.js";
import {
  ArchivedGfsForecastProfileService,
  type ArchivedGfsForecastProfileQuery,
  type ArchivedGfsForecastProfileResult,
} from "./history-forecast.js";
import {
  IgraObservationProfileService,
  type IgraObservationProfileQuery,
  type IgraObservationProfileResult,
} from "./igra-observation.js";
import { circularDegreeDelta } from "./run-comparison.js";

const HOUR_MS = 60 * 60 * 1_000;
const CAVEAT =
  "Radiosonde verification compares a point observation profile with a model grid-cell forecast; no vertical interpolation is performed, and sounding drift/instrument or station changes can affect comparability" as const;

type Level = IgraObservationProfileResult["levels"][number];

export interface IgraObservationProfileGetter {
  getProfile(input: IgraObservationProfileQuery): Promise<IgraObservationProfileResult>;
}

export interface IgraArchivedForecastProfileGetter {
  getArchivedForecastProfile(input: ArchivedGfsForecastProfileQuery): Promise<ArchivedGfsForecastProfileResult>;
}

export interface IgraForecastVerificationServiceOptions {
  observationGetter?: IgraObservationProfileGetter;
  forecastGetter?: IgraArchivedForecastProfileGetter;
  now?: () => Date;
}

export class IgraForecastVerificationService {
  private readonly observationGetter: IgraObservationProfileGetter;
  private readonly forecastGetter: IgraArchivedForecastProfileGetter;
  private readonly now: () => Date;

  constructor(options: IgraForecastVerificationServiceOptions = {}) {
    this.observationGetter = options.observationGetter ?? new IgraObservationProfileService();
    this.forecastGetter = options.forecastGetter ?? new ArchivedGfsForecastProfileService();
    this.now = options.now ?? (() => new Date());
  }

  async verify(input: IgraForecastVerificationQueryInput): Promise<IgraForecastVerificationResult> {
    const query = igraForecastVerificationQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    if (validTime > this.now()) throw new Error("IGRA verification validTime must not be in the future");

    const forecastRun = new Date(validTime.getTime() - query.leadHours * HOUR_MS);
    const grid = query.gfsGrid
      ?? (forecastRun >= RDA_GFS_0P25_FORECAST_START ? "0p25" : "0p50");

    const observation = await this.observationGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      validTime,
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
      maxStationDistanceKm: query.maxStationDistanceKm,
    });

    const forecast = await this.forecastGetter.getArchivedForecastProfile({
      runTime: forecastRun,
      grid,
      forecastHour: query.leadHours,
      latitude: observation.station.soundingLatitude,
      longitude: observation.station.soundingLongitude,
      variables: query.variables,
      pressureLevelsHpa: observation.matchedPressureLevelsHpa,
    });

    if (forecast.validTime !== observation.nominalTime) {
      throw new Error("Archived GFS forecast valid time does not match IGRA sounding nominal time");
    }

    return igraForecastVerificationResultSchema.parse({
      model: "gfs_igra_verification",
      validTime: validTime.toISOString(),
      leadHours: query.leadHours,
      forecastRun: forecastRun.toISOString(),
      gfsGrid: grid,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      station: observation.station,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      comparison: "observation_minus_forecast",
      forecast: {
        model: forecast.model,
        runTime: forecast.runTime,
        forecastHour: forecast.forecastHour,
        validTime: forecast.validTime,
        gridPoint: forecast.gridPoint,
        levels: forecast.levels,
        dataset: forecast.source.dataset,
        cacheHit: forecast.source.cacheHit,
      },
      observation: {
        dataset: "igra_v2_2",
        nominalTime: observation.nominalTime,
        levels: observation.levels,
        sourceFile: observation.source.sourceFile,
        cacheHit: observation.source.cacheHit,
      },
      matchedPressureLevelsHpa: observation.matchedPressureLevelsHpa,
      missingPressureLevelsHpa: observation.missingPressureLevelsHpa,
      pressureLevels: compareForecastToObservation(forecast.levels, observation.levels),
      source: {
        provider: "NOAA NCEI",
        observationAccess: "igra_v2_2_station_file",
        forecastArchiveAccess: forecast.source.access,
      },
      caveat: CAVEAT,
    });
  }
}

export function compareForecastToObservation(
  forecastLevels: readonly Level[],
  observationLevels: readonly Level[],
): IgraForecastVerificationResult["pressureLevels"] {
  const forecasts = new Map(forecastLevels.map((level) => [pressureKey(level.pressureHpa), level]));
  const observations = new Map(observationLevels.map((level) => [pressureKey(level.pressureHpa), level]));
  const pressures = [...observations.values()]
    .map((level) => level.pressureHpa)
    .sort((a, b) => b - a);

  return pressures.map((pressureHpa) => ({
    pressureHpa,
    changes: compareLevel(
      forecasts.get(pressureKey(pressureHpa)),
      observations.get(pressureKey(pressureHpa)),
    ),
  }));
}

function compareLevel(forecast: Level | undefined, observation: Level | undefined) {
  if (!forecast || !observation) return [];
  const forecastRecord = forecast as unknown as Record<string, unknown>;
  const observationRecord = observation as unknown as Record<string, unknown>;
  const fields = Object.keys(observationRecord)
    .filter((field) => field !== "pressureHpa")
    .sort();

  return fields.flatMap((field) => {
    const forecastValue = forecastRecord[field];
    const observationValue = observationRecord[field];
    if (
      typeof forecastValue !== "number"
      || typeof observationValue !== "number"
      || !Number.isFinite(forecastValue)
      || !Number.isFinite(observationValue)
    ) return [];

    const deltaKind = /direction.*deg/i.test(field)
      ? "circular_degrees" as const
      : "linear" as const;
    return [{
      field,
      forecast: forecastValue,
      observation: observationValue,
      delta: deltaKind === "circular_degrees"
        ? circularDegreeDelta(forecastValue, observationValue)
        : observationValue - forecastValue,
      deltaKind,
    }];
  });
}

function pressureKey(pressureHpa: number): number {
  return Math.round(pressureHpa * 1_000);
}
