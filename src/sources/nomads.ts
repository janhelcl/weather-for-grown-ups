import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";

export interface NomadsPointRequest {
  run: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields?: RawNonIsobaricFieldDefinition[];
}

export interface NomadsAreaRequest {
  run: Date;
  forecastHour: number;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
}

interface NomadsRequest extends NomadsAreaRequest {
  fields?: RawNonIsobaricFieldDefinition[];
}

export function buildNomadsPointUrl(request: NomadsPointRequest): string {
  return buildNomadsUrl({
    run: request.run,
    forecastHour: request.forecastHour,
    westLongitude: Math.max(-180, request.longitude - 0.5),
    eastLongitude: Math.min(180, request.longitude + 0.5),
    southLatitude: Math.max(-90, request.latitude - 0.5),
    northLatitude: Math.min(90, request.latitude + 0.5),
    variables: request.variables,
    pressureLevelsHpa: request.pressureLevelsHpa,
    ...(request.fields === undefined ? {} : { fields: request.fields }),
  });
}

export function buildNomadsAreaUrl(request: NomadsAreaRequest): string {
  return buildNomadsUrl(request);
}

function buildNomadsUrl(request: NomadsRequest): string {
  const runDate = yyyymmdd(request.run);
  const runHour = request.run.getUTCHours().toString().padStart(2, "0");
  const forecastHour = request.forecastHour.toString().padStart(3, "0");

  const params = new URLSearchParams({
    dir: `/gfs.${runDate}/${runHour}/atmos`,
    file: `gfs.t${runHour}z.pgrb2.0p25.f${forecastHour}`,
    subregion: "",
    toplat: request.northLatitude.toString(),
    bottomlat: request.southLatitude.toString(),
    leftlon: request.westLongitude.toString(),
    rightlon: request.eastLongitude.toString(),
  });

  const fields = request.fields ?? [];
  const variableCodes = [
    ...new Set([
      ...request.variables.map((variable) => variable.gfsCode),
      ...fields.map((field) => field.gfsCode),
    ]),
  ].sort();
  const pressureLevels = [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a);
  const nonIsobaricLevels = [...new Set(fields.map((field) => field.level.nomadsLevel))].sort();

  for (const code of variableCodes) params.set(`var_${code}`, "on");
  for (const level of pressureLevels) params.set(`lev_${level}_mb`, "on");
  for (const level of nonIsobaricLevels) params.set(`lev_${level}`, "on");

  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?${params.toString()}`;
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
