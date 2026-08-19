import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import { NomadsCache, type CachedFile } from "../cache/nomads-cache.js";
import { GfsS3SubsetCache } from "../cache/s3-subset-cache.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import { deriveWind } from "../derived/wind.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import { profileQuerySchema, type ProfileQueryInput, type ProfileSourceId } from "../schema/query.js";
import { NomadsProfileSource, S3ProfileSource } from "../sources/profile-source.js";
import type { ProfileDataSource } from "../sources/types.js";
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
  sources?: Partial<Record<ProfileSourceId, ProfileDataSource>>;
}

export class ProfileService {
  private readonly decoder: PointDecoder;
  private readonly latestRunProvider: LatestRunProvider;
  private readonly sources: Record<ProfileSourceId, ProfileDataSource>;

  constructor(options: ProfileServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    const nomadsCache = options.cache ?? new NomadsCache(join(cacheDir, "grib"), limiter);

    this.sources = {
      nomads: new NomadsProfileSource(nomadsCache as NomadsCache),
      s3: new S3ProfileSource(new GfsS3SubsetCache(join(cacheDir, "s3"))),
      ...options.sources,
    };
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
    const source = this.sources[query.source];

    const cached = await source.fetch({
      run,
      forecastHour: fh,
      latitude: query.latitude,
      longitude: query.longitude,
      variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
    });
    const values = await this.decoder.extractPoint(cached.path, query.longitude, query.latitude);
    const firstValue = values[0];
    if (!firstValue) throw new Error("No values decoded from GFS response");

    assertComplete(values, variables.map((variable) => variable.gfsCode), query.pressureLevelsHpa);

    const levelMap = new Map<number, ProfileLevel>();
    for (const pressureHpa of query.pressureLevelsHpa) levelMap.set(pressureHpa, { pressureHpa });

    for (const value of values) {
      const level = levelMap.get(value.pressureHpa);
      if (!level) continue;
      applyDecodedValue(level, value);
    }

    if (query.variables.includes("wind")) {
      for (const level of levelMap.values()) {
        if (level.uWindMs === undefined || level.vWindMs === undefined) continue;
        const wind = deriveWind(level.uWindMs, level.vWindMs);
        level.windSpeedMs = wind.speedMs;
        level.windDirectionDeg = wind.directionDeg;
      }
    }

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: firstValue.gridPoint,
      levels: [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa),
      source: {
        provider: source.provider,
        access: source.access,
        decoder: "wgrib2",
        cacheHit: cached.cacheHit,
      },
    };
  }
}

function applyDecodedValue(level: ProfileLevel, value: DecodedValue): void {
  switch (value.code) {
    case "TMP": level.temperatureC = value.value - 273.15; break;
    case "RH": level.relativeHumidityPct = value.value; break;
    case "UGRD": level.uWindMs = value.value; break;
    case "VGRD": level.vWindMs = value.value; break;
    case "HGT": level.geopotentialHeightGpm = value.value; break;
    case "SPFH": level.specificHumidityKgKg = value.value; break;
    case "VVEL": level.verticalVelocityPaS = value.value; break;
    case "DZDT": level.geometricVerticalVelocityMs = value.value; break;
    case "ABSV": level.absoluteVorticityS1 = value.value; break;
    case "TCDC": level.totalCloudCoverPct = value.value; break;
    case "CLWMR": level.cloudWaterMixingRatioKgKg = value.value; break;
    case "O3MR": level.ozoneMixingRatioKgKg = value.value; break;
  }
}

function assertComplete(values: DecodedValue[], codes: string[], levels: number[]): void {
  const seen = new Set(values.map((value) => `${value.code}@${value.pressureHpa}`));
  const missing = [...new Set(codes)].flatMap((code) =>
    [...new Set(levels)]
      .filter((level) => !seen.has(`${code}@${level}`))
      .map((level) => `${code}@${level}mb`),
  );
  if (missing.length > 0) {
    throw new Error(`Decoded GFS data is missing requested fields: ${missing.join(", ")}`);
  }
}
