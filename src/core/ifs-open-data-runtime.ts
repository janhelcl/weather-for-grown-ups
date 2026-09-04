import { join } from "node:path";
import {
  IfsOpenDataAccessPolicy,
  type IfsHttpAccessPolicy,
} from "../access/ifs-open-data.js";
import { IfsOpenDataSubsetCache } from "../cache/ifs-open-data-cache.js";
import { IFS_OPEN_DATA_MIRRORS } from "../sources/ifs-open-data.js";

export function createIfsOpenDataAccessPolicy(cacheDir: string): IfsHttpAccessPolicy {
  const directMirror = IFS_OPEN_DATA_MIRRORS.find((mirror) => mirror.id === "ecmwf");
  if (directMirror === undefined) {
    throw new Error("ECMWF direct open-data mirror is not configured");
  }
  return new IfsOpenDataAccessPolicy({
    stateDir: join(cacheDir, "access-state"),
    directBaseUrl: directMirror.baseUrl,
  });
}

export function createIfsOpenDataSubsetCache(cacheDir: string): IfsOpenDataSubsetCache {
  return new IfsOpenDataSubsetCache(
    cacheDir,
    createIfsOpenDataAccessPolicy(cacheDir),
  );
}
