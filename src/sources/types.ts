import type { RawVariableDefinition } from "../catalog/variables.js";

export type ProfileSourceId = "nomads" | "s3";
export type ProfileProvider = "NOAA NOMADS" | "NOAA AWS Open Data";
export type ProfileAccessMethod = "nomads_grib_filter" | "s3_range";

export interface ProfileDataRequest {
  run: Date;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
}

export interface ProfileSourceFile {
  path: string;
  cacheHit: boolean;
}

export interface ProfileDataSource {
  id: ProfileSourceId;
  provider: ProfileProvider;
  access: ProfileAccessMethod;
  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile>;
}
