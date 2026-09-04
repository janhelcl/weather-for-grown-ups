import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const OPERATIONAL_GFS_CACHES = [
  "src/cache/nomads-cache.ts",
  "src/cache/s3-subset-cache.ts",
] as const;

describe("operational GFS cache boundary", () => {
  it("keeps provider access, transport and GRIB selection out of cache decorators", async () => {
    for (const path of OPERATIONAL_GFS_CACHES) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/from ["']\.\.\/access\//);
      expect(source, path).not.toMatch(/WFG_USER_AGENT|globalThis\.fetch|fetchWithRetry|runWithHttpRetry/);
      expect(source, path).not.toMatch(/buildNomads|buildGfsS3|parseGribIndex|selectPressureByteRanges|selectNonIsobaricByteRanges|mergeByteRanges/);
    }
  });

  it("keeps filesystem persistence out of the operational GFS provider sources", async () => {
    for (const path of ["src/sources/nomads.ts", "src/sources/gfs-s3.ts"]) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/from ["']node:(?:fs|path)/);
      expect(source, path).not.toMatch(/FileArtifactCache|cacheDir/);
    }
  });
});
