import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import type { GfsGrid } from "../schema/gfs-grid.js";

export type ProfileSourceId = "nomads" | "s3";
export type ProfileProvider = "NOAA NOMADS" | "NOAA AWS Open Data";
export type ProfileAccessMethod = "nomads_grib_filter" | "nomads_range" | "s3_range";

export interface ProfileDataRequest {
  run: Date;
  grid?: GfsGrid;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields?: RawNonIsobaricFieldDefinition[];
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
