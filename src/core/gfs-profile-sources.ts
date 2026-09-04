import type {
  ProfileDataRequest,
  ProfileDataSource,
  ProfileSourceFile,
} from "../sources/types.js";

export interface ProfileFileCache {
  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile>;
}

export class NomadsProfileSource implements ProfileDataSource {
  readonly id = "nomads" as const;
  readonly provider = "NOAA NOMADS" as const;
  readonly access = "nomads_grib_filter" as const;

  constructor(private readonly cache: ProfileFileCache) {}

  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.cache.fetch(request);
  }
}

export class S3ProfileSource implements ProfileDataSource {
  readonly id = "s3" as const;
  readonly provider = "NOAA AWS Open Data" as const;
  readonly access = "s3_range" as const;

  constructor(private readonly cache: ProfileFileCache) {}

  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.cache.fetch(request);
  }
}
