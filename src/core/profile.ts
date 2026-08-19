import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NomadsCache, type CachedFile } from "../cache/nomads-cache.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import { deriveWind } from "../derived/wind.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import { profileQuerySchema, type ProfileQueryInput } from "../schema/query.js";
import { buildNomadsPointUrl } from "../sources/nomads.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import type { DecodedValue, ProfileLevel, ProfileResult } from "./types.js";

export interface ProfileCache {
  fetch(url: string): Promise<CachedFile>;
}

export interface PointDecoder {
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface ProfileServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
  wgrib2Path?: string;
  cache?: ProfileCache;
  decoder?: PointDecoder;
  latestRunProvider?: LatestRunProvider;
}

export class ProfileService {
  private readonly decoder: PointDecoder;
  private readonly cache: ProfileCache;
  private readonly latestRunProvider: LatestRunProvider;

  constructor(options: ProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");

    if (options.cache) {
      this.cache = options.cache;
    } else {
      const limiter = new FileRateLimiter(
        join(cacheDir, "state"),
        options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
      );
      this.cache = new NomadsCache(join(cacheDir, "grib"), limiter);
    }

    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
  }

  async getProfile(input: ProfileQueryInput): Promise<ProfileResult> {
    const query = profileQuerySchema.parse(input);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun()
      : parseGfsRun(query.run);
    const validTime = new Date(query.validTime);
    const fh = forecastHour(run, validTime);
    const variables = expandRequestedVariables(query.variables);

    const url = buildNomadsPointUrl({
      run,
      forecastHour: fh,
      latitude: query.latitude,
      longitude: query.longitude,
      variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
    });

    const cached = await this.cache.fetch(url);
    const values = await this.decoder.extractPoint(cached.path, query.longitude, query.latitude);
    const levelMap = new Map<number, ProfileLevel>();

    for (const pressureHpa of query.pressureLevelsHpa) levelMap.set(pressureHpa, { pressureHpa });

    for (const value of values) {
      const level = levelMap.get(value.pressureHpa);
      if (!level) continue;
      switch (value.code) {
        case "TMP":
          level.temperatureC = value.value - 273.15;
          break;
        case "RH":
          level.relativeHumidityPct = value.value;
          break;
        case "UGRD":
          level.uWindMs = value.value;
          break;
        case "VGRD":
          level.vWindMs = value.value;
          break;
      }
    }

    if (query.variables.includes("wind")) {
      for (const level of levelMap.values()) {
        if (level.uWindMs === undefined || level.vWindMs === undefined) continue;
        const wind = deriveWind(level.uWindMs, level.vWindMs);
        level.windSpeedMs = wind.speedMs;
        level.windDirectionDeg = wind.directionDeg;
      }
    }

    const firstValue = values[0];
    if (!firstValue) throw new Error("No values decoded from GFS response");

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: firstValue.gridPoint,
      levels: [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa),
      source: {
        provider: "NOAA NOMADS",
        decoder: "wgrib2",
        cacheHit: cached.cacheHit,
      },
    };
  }
}
