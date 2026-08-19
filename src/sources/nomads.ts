import type { RawVariableDefinition } from "../catalog/variables.js";

export interface NomadsPointRequest {
  run: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
}

export function buildNomadsPointUrl(request: NomadsPointRequest): string {
  const runDate = yyyymmdd(request.run);
  const runHour = request.run.getUTCHours().toString().padStart(2, "0");
  const forecastHour = request.forecastHour.toString().padStart(3, "0");

  const params = new URLSearchParams({
    dir: `/gfs.${runDate}/${runHour}/atmos`,
    file: `gfs.t${runHour}z.pgrb2.0p25.f${forecastHour}`,
    subregion: "",
    toplat: Math.min(90, request.latitude + 0.5).toString(),
    bottomlat: Math.max(-90, request.latitude - 0.5).toString(),
    leftlon: Math.max(-180, request.longitude - 0.5).toString(),
    rightlon: Math.min(180, request.longitude + 0.5).toString(),
  });

  const variableCodes = [...new Set(request.variables.map((variable) => variable.gfsCode))].sort();
  const levels = [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a);

  for (const code of variableCodes) params.set(`var_${code}`, "on");
  for (const level of levels) params.set(`lev_${level}_mb`, "on");

  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?${params.toString()}`;
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
