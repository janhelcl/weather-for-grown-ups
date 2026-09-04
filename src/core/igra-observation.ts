import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { CachedNceiIgraSource } from "../cache/igra-cache.js";
import { deriveSaturationVaporPressureHpa } from "../derived/thermodynamics.js";
import type { IgraVerificationVariable } from "../schema/igra-verification.js";
import type { ProfileLevel } from "./types.js";
import {
  NceiIgraSource,
  type IgraSounding,
  type IgraSoundingLevel,
  type IgraStation,
} from "../sources/ncei-igra.js";

export interface IgraObservationProfileQuery {
  latitude: number;
  longitude: number;
  validTime: Date;
  variables: readonly IgraVerificationVariable[];
  pressureLevelsHpa: readonly number[];
  stationId?: string;
  maxStationDistanceKm: number;
}

export interface IgraObservationProfileResult {
  nominalTime: string;
  requestedPoint: { latitude: number; longitude: number };
  station: IgraStation & {
    distanceKm: number;
    soundingLatitude: number;
    soundingLongitude: number;
  };
  levels: ProfileLevel[];
  matchedPressureLevelsHpa: number[];
  missingPressureLevelsHpa: number[];
  source: {
    provider: "NOAA NCEI";
    access: "igra_v2_2_station_file";
    dataset: "igra_v2_2";
    sourceFile: string;
    cacheHit: boolean;
  };
}

export interface IgraObservationSource {
  listStations(): Promise<IgraStation[]>;
  getSounding(stationId: string, nominalTime: Date): Promise<IgraSounding>;
}

export interface IgraObservationProfileServiceOptions {
  cacheDir?: string;
  accessPolicy?: UpstreamAccessPolicy;
  source?: IgraObservationSource;
  now?: () => Date;
}

export class IgraObservationProfileService {
  private readonly source: IgraObservationSource;
  private readonly now: () => Date;

  constructor(options: IgraObservationProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const accessPolicy = options.accessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiIgra);
    const now = options.now ?? (() => new Date());
    this.source = options.source ?? new CachedNceiIgraSource(
      join(cacheDir, "igra"),
      new NceiIgraSource({
        limiter: accessPolicy,
        now,
      }),
      now,
    );
    this.now = now;
  }

  async getProfile(query: IgraObservationProfileQuery): Promise<IgraObservationProfileResult> {
    if (query.validTime > this.now()) throw new Error("IGRA verification validTime must not be in the future");

    const stations = await this.source.listStations();
    const station = selectIgraStation(
      stations,
      { latitude: query.latitude, longitude: query.longitude },
      query.validTime.getUTCFullYear(),
      query.maxStationDistanceKm,
      query.stationId,
    );

    const sounding = await this.source.getSounding(station.id, query.validTime);
    const soundingLatitude = Number.isFinite(sounding.soundingLatitude)
      ? sounding.soundingLatitude
      : station.latitude;
    const soundingLongitude = Number.isFinite(sounding.soundingLongitude)
      ? sounding.soundingLongitude
      : station.longitude;
    const distanceKm = greatCircleDistanceKm(
      query.latitude,
      query.longitude,
      soundingLatitude,
      soundingLongitude,
    );
    if (distanceKm > query.maxStationDistanceKm) {
      throw new Error(
        `IGRA station ${station.id} sounding location is ${distanceKm.toFixed(1)} km from the requested point, beyond maxStationDistanceKm=${query.maxStationDistanceKm}`,
      );
    }

    const byPressure = new Map(
      sounding.levels.map((level) => [pressureKey(level.pressureHpa), level]),
    );
    const levels: ProfileLevel[] = [];
    const matchedPressureLevelsHpa: number[] = [];
    const missingPressureLevelsHpa: number[] = [];

    for (const pressureHpa of query.pressureLevelsHpa) {
      const raw = byPressure.get(pressureKey(pressureHpa));
      if (!raw) {
        missingPressureLevelsHpa.push(pressureHpa);
        continue;
      }
      matchedPressureLevelsHpa.push(pressureHpa);
      levels.push(projectObservationLevel(raw, query.variables));
    }

    if (levels.length === 0) {
      throw new Error(
        `IGRA sounding ${station.id} at ${sounding.nominalTime} contains none of the requested exact pressure levels; no vertical interpolation is performed`,
      );
    }

    return {
      nominalTime: sounding.nominalTime,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      station: {
        ...station,
        distanceKm,
        soundingLatitude,
        soundingLongitude,
      },
      levels,
      matchedPressureLevelsHpa,
      missingPressureLevelsHpa,
      source: {
        provider: "NOAA NCEI",
        access: "igra_v2_2_station_file",
        dataset: "igra_v2_2",
        sourceFile: sounding.sourceFile,
        cacheHit: sounding.cacheHit,
      },
    };
  }
}

export function selectIgraStation(
  stations: readonly IgraStation[],
  point: { latitude: number; longitude: number },
  year: number,
  maxDistanceKm: number,
  stationId?: string,
): IgraStation {
  if (stationId !== undefined) {
    const station = stations.find((candidate) => candidate.id === stationId);
    if (!station) throw new Error(`Unknown IGRA stationId ${stationId}`);
    if (year < station.firstYear || year > station.lastYear) {
      throw new Error(
        `IGRA station ${stationId} does not cover ${year}; period of record is ${station.firstYear}-${station.lastYear}`,
      );
    }
    const distanceKm = greatCircleDistanceKm(
      point.latitude,
      point.longitude,
      station.latitude,
      station.longitude,
    );
    if (distanceKm > maxDistanceKm) {
      throw new Error(
        `IGRA station ${stationId} is ${distanceKm.toFixed(1)} km from the requested point, beyond maxStationDistanceKm=${maxDistanceKm}`,
      );
    }
    return station;
  }

  let best: { station: IgraStation; distanceKm: number } | undefined;
  for (const station of stations) {
    if (year < station.firstYear || year > station.lastYear) continue;
    const distanceKm = greatCircleDistanceKm(
      point.latitude,
      point.longitude,
      station.latitude,
      station.longitude,
    );
    if (best === undefined || distanceKm < best.distanceKm) best = { station, distanceKm };
  }

  if (best === undefined || best.distanceKm > maxDistanceKm) {
    throw new Error(
      `No IGRA station covering ${year} is within maxStationDistanceKm=${maxDistanceKm} of the requested point`,
    );
  }
  return best.station;
}

export function greatCircleDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radiusKm = 6_371.0088;
  const toRadians = (value: number) => value * Math.PI / 180;
  const phi1 = toRadians(latitude1);
  const phi2 = toRadians(latitude2);
  const deltaPhi = toRadians(latitude2 - latitude1);
  const deltaLambda = toRadians(longitude2 - longitude1);
  const a = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectObservationLevel(
  source: IgraSoundingLevel,
  variables: readonly IgraVerificationVariable[],
): ProfileLevel {
  const result: ProfileLevel = { pressureHpa: source.pressureHpa };
  for (const variable of variables) {
    if (variable === "temperature" && source.temperatureC !== undefined) {
      result.temperatureC = source.temperatureC;
    } else if (variable === "relative_humidity") {
      const relativeHumidityPct = source.relativeHumidityPct
        ?? derivedRelativeHumidityPct(source.temperatureC, source.dewPointC);
      if (relativeHumidityPct !== undefined) {
        result.relativeHumidityPct = relativeHumidityPct;
      }
    } else if (variable === "geopotential_height" && source.geopotentialHeightGpm !== undefined) {
      result.geopotentialHeightGpm = source.geopotentialHeightGpm;
    } else if (variable === "dew_point" && source.dewPointC !== undefined) {
      result.dewPointC = source.dewPointC;
    } else if (variable === "wind") {
      if (source.windSpeedMs !== undefined) result.windSpeedMs = source.windSpeedMs;
      if (source.windDirectionDeg !== undefined) result.windDirectionDeg = source.windDirectionDeg;
    }
  }
  return result;
}

function derivedRelativeHumidityPct(
  temperatureC: number | undefined,
  dewPointC: number | undefined,
): number | undefined {
  if (temperatureC === undefined || dewPointC === undefined) return undefined;
  const saturation = deriveSaturationVaporPressureHpa(temperatureC);
  const vapor = deriveSaturationVaporPressureHpa(dewPointC);
  return Math.max(0, Math.min(100, 100 * vapor / saturation));
}

function pressureKey(pressureHpa: number): number {
  return Math.round(pressureHpa * 1_000);
}
