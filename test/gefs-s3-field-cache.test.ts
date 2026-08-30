import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GefsS3SubsetCache } from "../src/cache/gefs-s3-subset-cache.js";
import { GEFS_PGRB2A_FIELD_CATALOG } from "../src/catalog/gefs-fields.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GEFS non-isobaric subset cache", () => {
  it("selects exact field semantics and canonicalizes field order", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-fields-"));
    roots.push(root);
    const index = [
      "1:0:d=2026082312:APCP:surface:0-3 hour acc fcst:",
      "2:100:d=2026082312:TCDC:entire atmosphere:0-3 hour ave fcst:",
      "3:200:d=2026082312:PRMSL:mean sea level:3 hour fcst:",
      "4:300:d=2026082312:TMP:2 m above ground:3 hour fcst:",
    ].join("\n");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".idx")) return new Response(index, { status: 200 });
      expect(init?.headers).toEqual(expect.objectContaining({ range: expect.stringMatching(/^bytes=/) }));
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new GefsS3SubsetCache(root, fetchFn);
    const precipitation = GEFS_PGRB2A_FIELD_CATALOG.total_precipitation;
    const cloud = GEFS_PGRB2A_FIELD_CATALOG.total_atmosphere_cloud_cover;
    if (precipitation.kind !== "raw" || cloud.kind !== "raw") throw new Error("expected raw fixtures");
    const request = {
      run: new Date("2026-08-23T12:00:00Z"),
      forecastHour: 3,
      member: "c00" as const,
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: [precipitation, cloud],
    };

    const first = await cache.fetchSelection(request);
    const second = await cache.fetchSelection({ ...request, fields: [cloud, precipitation] });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.path).toBe(first.path);
    expect(fetchFn).toHaveBeenCalledTimes(3); // one cached index + two exact field messages
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/atmos/pgrb2sp25/");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(".pgrb2s.0p25.f003.idx");
  });

  it("writes safely when separate cache instances download the same selection concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-fields-race-"));
    roots.push(root);
    const index = [
      "1:0:d=2026082312:TMP:2 m above ground:3 hour fcst:",
      "2:100:d=2026082312:PRMSL:mean sea level:3 hour fcst:",
    ].join("\n");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".idx")) return new Response(index, { status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(init?.headers).toEqual(expect.objectContaining({ range: expect.stringMatching(/^bytes=/) }));
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const field = GEFS_PGRB2A_FIELD_CATALOG.temperature_2m;
    if (field.kind !== "raw") throw new Error("expected raw fixture");
    const request = {
      run: new Date("2026-08-23T12:00:00Z"),
      forecastHour: 3,
      member: "c00" as const,
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: [field],
    };

    const firstCache = new GefsS3SubsetCache(root, fetchFn);
    const secondCache = new GefsS3SubsetCache(root, fetchFn);
    const [first, second] = await Promise.all([
      firstCache.fetchSelection(request),
      secondCache.fetchSelection(request),
    ]);

    expect(first.path).toBe(second.path);
  });

  it("keeps mixed pressure-and-field selections on the 0.5 product", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-mixed-fields-"));
    roots.push(root);
    const index = [
      "1:0:d=2026082312:TMP:850 mb:3 hour fcst:",
      "2:100:d=2026082312:TMP:2 m above ground:3 hour fcst:",
    ].join("\n");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".idx")) return new Response(index, { status: 200 });
      expect(init?.headers).toEqual(expect.objectContaining({ range: expect.stringMatching(/^bytes=/) }));
      return new Response(new TextEncoder().encode("GRIB"), { status: 206 });
    }) as typeof fetch;
    const cache = new GefsS3SubsetCache(root, fetchFn);
    const temperature2m = GEFS_PGRB2A_FIELD_CATALOG.temperature_2m;
    if (temperature2m.kind !== "raw") throw new Error("expected raw fixture");

    await cache.fetchSelection({
      run: new Date("2026-08-23T12:00:00Z"),
      forecastHour: 3,
      member: "c00",
      variableCodes: ["TMP"],
      pressureLevelsHpa: [850],
      fields: [temperature2m],
    });

    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/atmos/pgrb2ap5/");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(".pgrb2a.0p50.f003.idx");
  });

  it("rejects an empty pressure-and-field selection before writing a subset", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-fields-empty-"));
    roots.push(root);
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(".idx")
        ? new Response("1:0:d=2026082312:TMP:850 mb:3 hour fcst:\n", { status: 200 })
        : new Response(new TextEncoder().encode("GRIB"), { status: 206 })) as typeof fetch;
    const cache = new GefsS3SubsetCache(root, fetchFn);

    await expect(cache.fetchSelection({
      run: new Date("2026-08-23T12:00:00Z"),
      forecastHour: 3,
      member: "c00",
      variableCodes: [],
      pressureLevelsHpa: [],
    })).rejects.toThrow("selected no GRIB messages");
  });
});
