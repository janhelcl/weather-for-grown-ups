import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpstreamAccessPolicy } from "../src/access/access-policy.js";
import { AigfsNomadsSubsetCache } from "../src/cache/aigfs-nomads-subset-cache.js";
import {
  AIGFS_PRESSURE_LEVELS_HPA,
  expandAigfsRequestedFields,
  expandAigfsRequestedVariables,
} from "../src/catalog/aigfs.js";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import {
  createAtmosphericQueryAdapterRegistry,
} from "../src/core/query-adapters/registry.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";
import {
  AIGFS_NATIVE_FORECAST_HOURS,
  aigfsForecastHour,
  aigfsNativeForecastHoursInRange,
  buildAigfsNomadsIndexUrl,
  buildAigfsNomadsUrl,
} from "../src/sources/aigfs.js";
import { diagnoseAtmosphereSchema, queryAtmosphereSchema } from "../src/schema/unified-api.js";

const passthroughPolicy: UpstreamAccessPolicy = {
  run: async <T>(operation: () => Promise<T>) => operation(),
};

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "wfg-aigfs-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("AIGFS source contract", () => {
  it("builds operational NOMADS pres/sfc URLs and keeps the 6-hour native cadence", () => {
    const run = new Date("2026-08-30T00:00:00Z");
    expect(buildAigfsNomadsUrl(run, 6, "pres")).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/aigfs.20260830/00/model/atmos/grib2/aigfs.t00z.pres.f006.grib2",
    );
    expect(buildAigfsNomadsIndexUrl(run, 6, "sfc")).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/aigfs.20260830/00/model/atmos/grib2/aigfs.t00z.sfc.f006.grib2.idx",
    );
    expect(AIGFS_NATIVE_FORECAST_HOURS[0]).toBe(0);
    expect(AIGFS_NATIVE_FORECAST_HOURS.at(-1)).toBe(384);
    expect(AIGFS_NATIVE_FORECAST_HOURS).toHaveLength(65);
    expect(aigfsForecastHour(run, new Date("2026-08-30T06:00:00Z"))).toBe(6);
    expect(() => aigfsForecastHour(run, new Date("2026-08-30T03:00:00Z")))
      .toThrow("every 6 forecast hours");
    expect(aigfsNativeForecastHoursInRange(
      run,
      new Date("2026-08-30T03:00:00Z"),
      new Date("2026-08-30T15:00:00Z"),
    )).toEqual([6, 12]);
  });

  it("advertises exactly the published 13 pressure levels", () => {
    expect(AIGFS_PRESSURE_LEVELS_HPA).toEqual([
      50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000,
    ]);
  });

  it("uses one covering partial request per product and reuses cached indices", async () => {
    const pressureIndex = [
      "1:0:d=2026083000:HGT:850 mb:6 hour fcst:",
      "2:8:d=2026083000:SPFH:850 mb:6 hour fcst:",
      "3:16:d=2026083000:TMP:850 mb:6 hour fcst:",
      "4:24:d=2026083000:UGRD:850 mb:6 hour fcst:",
      "5:32:d=2026083000:VGRD:850 mb:6 hour fcst:",
      "6:40:d=2026083000:VVEL:850 mb:6 hour fcst:",
      "7:48:d=2026083000:HGT:700 mb:6 hour fcst:",
    ].join("\n");
    const surfaceIndex = [
      "1:0:d=2026083000:UGRD:10 m above ground:6 hour fcst:",
      "2:8:d=2026083000:VGRD:10 m above ground:6 hour fcst:",
      "3:16:d=2026083000:TMP:2 m above ground:6 hour fcst:",
      "4:24:d=2026083000:PRMSL:mean sea level:6 hour fcst:",
      "5:32:d=2026083000:APCP:surface:0-6 hour acc fcst:",
      "6:40:d=2026083000:APCP:surface:0-6 hour acc fcst:",
    ].join("\n");

    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(".idx")) {
        return new Response(url.includes(".pres.") ? pressureIndex : surfaceIndex, { status: 200 });
      }
      const range = new Headers(init?.headers).get("range");
      if (range === null) return new Response("missing range", { status: 400 });
      const bytes = new TextEncoder().encode("GRIB".padEnd(64, "x"));
      return new Response(bytes, { status: 206 });
    });

    const cache = new AigfsNomadsSubsetCache(
      rootDir,
      fetchFn as typeof fetch,
      passthroughPolicy,
    );
    const request = {
      run: new Date("2026-08-30T00:00:00Z"),
      forecastHour: 6,
      variables: expandAigfsRequestedVariables(["temperature", "u_wind"]),
      pressureLevelsHpa: [850],
      fields: expandAigfsRequestedFields(["temperature_2m", "mean_sea_level_pressure"]),
    };

    const first = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect((await readFile(first.path)).byteLength).toBe(128);

    const ranges = fetchFn.mock.calls
      .map(([, init]) => new Headers(init?.headers).get("range"))
      .filter((value): value is string => value !== null);
    expect(ranges).toEqual(["bytes=16-31", "bytes=16-31"]);

    const indexCallsAfterFirst = fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx")).length;
    const second = await cache.fetch(request);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(fetchFn.mock.calls.filter(([input]) => String(input).endsWith(".idx"))).toHaveLength(indexCallsAfterFirst);
  });
});

describe("AIGFS unified contract", () => {
  const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

  it("accepts supported state and rejects invented capability", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: {
        variables: ["temperature", "specific_humidity", "wind"],
        pressureLevelsHpa: [850, 700],
        fields: ["temperature_2m", "mean_sea_level_pressure"],
      },
    }).dataset).toBe("aigfs");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["relative_humidity"], pressureLevelsHpa: [850] },
    })).toThrow("AIGFS pressure variables not supported");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [750] },
    })).toThrow("AIGFS pressure levels not supported");

    expect(() => diagnoseAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700],
        parcel: "surface_2m",
      },
    })).toThrow("AIGFS parcel diagnostics are not exposed");
  });

  it("rejects derived area scalars while keeping point derivations available", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
    })).toThrow("native scalar pressure variable");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "aigfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    })).toThrow("native scalar field");
  });

  it("routes AIGFS through the same public query service", async () => {
    const aigfs = {
      query: vi.fn(async () => ({
        model: "aigfs_0p25",
        route: "aigfs-profile",
      })),
    };
    const service = new UnifiedAtmosphereQueryService({
      adapters: createAtmosphericQueryAdapterRegistry({ aigfs: aigfs as any }),
    });

    const result = await service.query({
      dataset: "aigfs",
      geometry: point,
      time: { at: "2026-08-30T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result).toMatchObject({
      dataset: "aigfs",
      internalDatasetId: "aigfs_0p25",
      kind: "deterministic",
      result: { route: "aigfs-profile" },
    });
    expect(aigfs.query).toHaveBeenCalledWith(expect.objectContaining({ dataset: "aigfs" }));
  });

  it("discovers AIGFS model class, cadence, state and diagnostics in the canonical catalog", () => {
    const catalog = searchAtmosphereCatalog({
      datasets: ["aigfs"],
      sections: ["variables", "fields", "layer_diagnostics", "profile_diagnostics", "parcel_definitions"],
      limit: 100,
    });

    expect(catalog.datasetCapabilities[0]).toMatchObject({
      dataset: "aigfs",
      provider: "noaa",
      modelClass: "ai",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 384,
      nativeForecastIntervalHours: 6,
    });
    expect(catalog.matches.some((match) => match.id === "temperature")).toBe(true);
    expect(catalog.matches.some((match) => match.id === "mean_sea_level_pressure")).toBe(true);
    expect(catalog.matches.some((match) => match.id === "temperature_lapse_rate")).toBe(true);
    expect(catalog.matches.some((match) => match.section === "parcel_definitions")).toBe(false);
  });
});
