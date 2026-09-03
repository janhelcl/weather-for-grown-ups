import type { NomadsCache } from "../cache/nomads-cache.js";
import { GfsS3SubsetCache } from "../cache/s3-subset-cache.js";
import { buildNomadsPointUrl } from "../sources/nomads.js";
import type {
  ProfileDataRequest,
  ProfileDataSource,
  ProfileSourceFile,
} from "../sources/types.js";

export class NomadsProfileSource implements ProfileDataSource {
  readonly id = "nomads" as const;
  readonly provider = "NOAA NOMADS" as const;
  readonly access = "nomads_grib_filter" as const;

  constructor(private readonly cache: Pick<NomadsCache, "fetch">) {}

  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.cache.fetch(buildNomadsPointUrl(request));
  }
}

export class S3ProfileSource implements ProfileDataSource {
  readonly id = "s3" as const;
  readonly provider = "NOAA AWS Open Data" as const;
  readonly access = "s3_range" as const;

  constructor(private readonly cache: GfsS3SubsetCache) {}

  fetch(request: ProfileDataRequest): Promise<ProfileSourceFile> {
    return this.cache.fetch(request);
  }
}
