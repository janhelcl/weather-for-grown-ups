import { homedir } from "node:os";
import { join } from "node:path";
import { NomadsCache } from "../cache/nomads-cache.js";
import { FileRateLimiter } from "../cache/file-rate-limiter.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import { deriveWind } from "../derived/wind.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import { profileQuerySchema, type ProfileQuery } from "../schema/query.js";
import { buildNomadsPointUrl } from "../sources/nomads.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import type { ProfileLevel, ProfileResult } from "./types.js";

export class ProfileService {
  private readonly decoder: Wgrib2Decoder;
  private readonly cache: NomadsCache;

  constructor(options?: { cacheDir?: string; cooldownMs?: number; wgrib2Path?: string }) {
    const cacheDir = options?.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(join(cacheDir, "state"), options?.cooldownMs ?? 11_000);
    this.cache = new NomadsCache(join(cacheDir, "grib"), limiter);
    this.decoder = new Wgrib2Decoder(options?.wgrib2Path);
  }

  async getProfile(input: ProfileQuery): Promise<ProfileResult> {
    const query = profileQuerySchema.parse(input);
    const run = parseGfsRun(query.run);
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
