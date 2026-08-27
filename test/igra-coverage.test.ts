import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IgraObservationProfileService, selectIgraStation } from "../src/core/igra-observation.js";
import { IgraForecastVerificationService } from "../src/core/igra-verification.js";
import {
  NceiIgraSource,
  extractSingleTextFileZip,
  type IgraStation,
} from "../src/sources/ncei-igra.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const prague: IgraStation = {
  id: "EZM00011520",
  latitude: 50.0078,
  longitude: 14.4469,
  elevationM: 302,
  name: "PRAHA-LIBUS",
  firstYear: 1969,
  lastYear: 2026,
  observations: 70000,
};

describe("NceiIgraSource cache and transport branches", () => {
  it("caches the station list and bypasses a second network request", async () => {
    const dir = await tempDir();
    const fetchFn = vi.fn(async () => new Response(stationLine(prague), { status: 200 }));
    const limiter = { run: vi.fn(async <T>(operation: () => Promise<T>) => operation()) };
    const source = new NceiIgraSource({ cacheDir: dir, limiter, fetchFn });

    expect((await source.listStations())[0]?.id).toBe(prague.id);
    expect((await source.listStations())[0]?.name).toBe("PRAHA-LIBUS");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(limiter.run).toHaveBeenCalledTimes(1);
  });

  it("uses current-year Y2D and older period-of-record station archives", async () => {
    const currentDir = await tempDir();
    const oldDir = await tempDir();
    const zip = soundingZip("EZM00011520", 2026, 8, 24, 12);
    const currentFetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/data-y2d/EZM00011520-data-beg2026.txt.zip");
      return new Response(zip, { status: 200 });
    });
    const oldFetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/data-por/EZM00011520-data.txt.zip");
      return new Response(soundingZip("EZM00011520", 2020, 8, 24, 12), { status: 200 });
    });
    const limiter = { run: async <T>(operation: () => Promise<T>) => operation() };

    const current = new NceiIgraSource({
      cacheDir: currentDir,
      limiter,
      fetchFn: currentFetch,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const old = new NceiIgraSource({
      cacheDir: oldDir,
      limiter,
      fetchFn: oldFetch,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    expect((await current.getSounding(prague.id, new Date("2026-08-24T12:00:00Z"))).cacheHit)
      .toBe(false);
    expect((await old.getSounding(prague.id, new Date("2020-08-24T12:00:00Z"))).cacheHit)
      .toBe(false);
  });

  it("reuses a cached station ZIP", async () => {
    const dir = await tempDir();
    const fetchFn = vi.fn(async () => new Response(
      soundingZip("EZM00011520", 2026, 8, 24, 12),
      { status: 200 },
    ));
    const source = new NceiIgraSource({
      cacheDir: dir,
      limiter: { run: async <T>(operation: () => Promise<T>) => operation() },
      fetchFn,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    expect((await source.getSounding(prague.id, new Date("2026-08-24T12:00:00Z"))).cacheHit)
      .toBe(false);
    expect((await source.getSounding(prague.id, new Date("2026-08-24T12:00:00Z"))).cacheHit)
      .toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("surfaces NOAA HTTP failures with the requested URL", async () => {
    const dir = await tempDir();
    const source = new NceiIgraSource({
      cacheDir: dir,
      limiter: { run: async <T>(operation: () => Promise<T>) => operation() },
      fetchFn: vi.fn(async () => new Response("nope", { status: 503, statusText: "Unavailable" })),
    });

    await expect(source.listStations()).rejects.toThrow(/HTTP 503 Unavailable/);
  });
});

describe("IGRA ZIP edge branches", () => {
  it("supports an uncompressed station text entry", () => {
    const text = "stored sounding\n";
    expect(extractSingleTextFileZip(singleFileZip(
      "station.txt",
      Buffer.from(text),
      0,
    ))).toBe(text);
  });

  it("rejects unsupported ZIP compression methods", () => {
    expect(() => extractSingleTextFileZip(singleFileZip(
      "station.txt",
      Buffer.from("x"),
      99,
    ))).toThrow(/Unsupported IGRA ZIP compression method 99/);
  });

  it("rejects data without an end-of-central-directory record", () => {
    expect(() => extractSingleTextFileZip(new Uint8Array(30))).toThrow(
      /end-of-central-directory record not found/,
    );
  });

  it("rejects malformed central and local ZIP headers", () => {
    const centralBroken = Buffer.from(singleFileZip("station.txt", Buffer.from("x"), 0));
    const centralOffset = centralBroken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    centralBroken.writeUInt32LE(0, centralOffset);
    expect(() => extractSingleTextFileZip(centralBroken)).toThrow(/central directory is malformed/);

    const localBroken = Buffer.from(singleFileZip("station.txt", Buffer.from("x"), 0));
    localBroken.writeUInt32LE(0, 0);
    expect(() => extractSingleTextFileZip(localBroken)).toThrow(/local file header is malformed/);
  });

  it("rejects a central-directory size mismatch", () => {
    const zip = Buffer.from(singleFileZip("station.txt", Buffer.from("abc"), 0));
    const centralOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(99, centralOffset + 24);
    expect(() => extractSingleTextFileZip(zip)).toThrow(/extracted size does not match/);
  });

  it("rejects ZIPs without a sounding text entry", () => {
    expect(() => extractSingleTextFileZip(singleFileZip(
      "readme.bin",
      Buffer.from("x"),
      0,
    ))).toThrow(/contains no sounding text file/);
  });
});

describe("IGRA station and observation guardrails", () => {
  it("rejects unknown and out-of-period explicit stations", () => {
    expect(() => selectIgraStation(
      [prague],
      { latitude: 50, longitude: 14.4 },
      2020,
      250,
      "AAA00000000",
    )).toThrow(/Unknown IGRA stationId/);

    expect(() => selectIgraStation(
      [prague],
      { latitude: 50, longitude: 14.4 },
      1950,
      250,
      prague.id,
    )).toThrow(/does not cover 1950/);
  });

  it("rejects automatic selection when no station is close enough", () => {
    expect(() => selectIgraStation(
      [prague],
      { latitude: 0, longitude: 0 },
      2020,
      25,
    )).toThrow(/No IGRA station/);
  });

  it("rejects future verification times", async () => {
    const service = new IgraObservationProfileService({
      source: {
        listStations: vi.fn(async () => [prague]),
        getSounding: vi.fn(),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.getProfile({
      latitude: 50,
      longitude: 14.4,
      validTime: new Date("2026-08-28T00:00:00Z"),
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxStationDistanceKm: 250,
    })).rejects.toThrow(/must not be in the future/);
  });

  it("falls back to station coordinates when sounding coordinates are absent", async () => {
    const service = new IgraObservationProfileService({
      source: {
        listStations: vi.fn(async () => [prague]),
        getSounding: vi.fn(async () => ({
          stationId: prague.id,
          nominalTime: "2026-08-24T12:00:00.000Z",
          soundingLatitude: Number.NaN,
          soundingLongitude: Number.NaN,
          levels: [{ pressureHpa: 850, temperatureC: 12 }],
          sourceFile: "test.zip",
          cacheHit: false,
        })),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.getProfile({
      latitude: prague.latitude,
      longitude: prague.longitude,
      validTime: new Date("2026-08-24T12:00:00Z"),
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxStationDistanceKm: 25,
    });

    expect(result.station.soundingLatitude).toBe(prague.latitude);
    expect(result.station.soundingLongitude).toBe(prague.longitude);
  });

  it("rechecks distance using sounding coordinates rather than station metadata only", async () => {
    const service = new IgraObservationProfileService({
      source: {
        listStations: vi.fn(async () => [prague]),
        getSounding: vi.fn(async () => ({
          stationId: prague.id,
          nominalTime: "2026-08-24T12:00:00.000Z",
          soundingLatitude: 55,
          soundingLongitude: 20,
          levels: [{ pressureHpa: 850, temperatureC: 12 }],
          sourceFile: "test.zip",
          cacheHit: false,
        })),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.getProfile({
      latitude: prague.latitude,
      longitude: prague.longitude,
      validTime: new Date("2026-08-24T12:00:00Z"),
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      maxStationDistanceKm: 25,
    })).rejects.toThrow(/sounding location is .* beyond/);
  });

  it("projects every supported observation variable without inventing missing wind fields", async () => {
    const service = new IgraObservationProfileService({
      source: {
        listStations: vi.fn(async () => [prague]),
        getSounding: vi.fn(async () => ({
          stationId: prague.id,
          nominalTime: "2026-08-24T12:00:00.000Z",
          soundingLatitude: prague.latitude,
          soundingLongitude: prague.longitude,
          levels: [{
            pressureHpa: 850,
            temperatureC: 12,
            relativeHumidityPct: 65,
            geopotentialHeightGpm: 1450,
            dewPointC: 6,
            windSpeedMs: 8,
          }],
          sourceFile: "test.zip",
          cacheHit: true,
        })),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    const result = await service.getProfile({
      latitude: prague.latitude,
      longitude: prague.longitude,
      validTime: new Date("2026-08-24T12:00:00Z"),
      variables: ["temperature", "relative_humidity", "geopotential_height", "dew_point", "wind"],
      pressureLevelsHpa: [850],
      maxStationDistanceKm: 25,
    });

    expect(result.levels[0]).toEqual({
      pressureHpa: 850,
      temperatureC: 12,
      relativeHumidityPct: 65,
      geopotentialHeightGpm: 1450,
      dewPointC: 6,
      windSpeedMs: 8,
    });
  });
});

describe("IGRA verification guardrails", () => {
  it("rejects future valid times before touching either source", async () => {
    const observationGetter = { getProfile: vi.fn() };
    const forecastGetter = { getArchivedForecastProfile: vi.fn() };
    const service = new IgraForecastVerificationService({
      observationGetter,
      forecastGetter,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.verify({
      latitude: 50,
      longitude: 14,
      validTime: "2026-08-28T00:00:00Z",
      leadHours: 48,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/must not be in the future/);
    expect(observationGetter.getProfile).not.toHaveBeenCalled();
  });

  it("rejects a forecast whose valid time differs from the sounding", async () => {
    const service = new IgraForecastVerificationService({
      observationGetter: {
        getProfile: vi.fn(async () => ({
          nominalTime: "2026-08-24T12:00:00.000Z",
          requestedPoint: { latitude: 50, longitude: 14 },
          station: {
            ...prague,
            distanceKm: 0,
            soundingLatitude: prague.latitude,
            soundingLongitude: prague.longitude,
          },
          levels: [{ pressureHpa: 850, temperatureC: 12 }],
          matchedPressureLevelsHpa: [850],
          missingPressureLevelsHpa: [],
          source: {
            provider: "NOAA NCEI" as const,
            access: "igra_v2_2_station_file" as const,
            dataset: "igra_v2_2" as const,
            sourceFile: "test.zip",
            cacheHit: true,
          },
        })),
      },
      forecastGetter: {
        getArchivedForecastProfile: vi.fn(async () => ({
          model: "gfs_0p25_forecast_archive" as const,
          runTime: "2026-08-22T12:00:00.000Z",
          forecastHour: 48,
          validTime: "2026-08-24T18:00:00.000Z",
          requestedPoint: { latitude: prague.latitude, longitude: prague.longitude },
          gridPoint: { latitude: 50, longitude: 14.5 },
          selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
          levels: [{ pressureHpa: 850, temperatureC: 10 }],
          source: {
            provider: "NCAR GDEX",
            access: "gdex_thredds_ncss",
            dataset: "test",
            cacheHit: true,
          },
          caveat: "test",
        })),
      },
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    await expect(service.verify({
      latitude: 50,
      longitude: 14,
      validTime: "2026-08-24T12:00:00Z",
      leadHours: 48,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow(/does not match IGRA sounding nominal time/);
  });
});

async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "wfg-igra-"));
  tempDirs.push(path);
  return path;
}

function stationLine(station: IgraStation): string {
  const chars = Array(88).fill(" ");
  put(chars, 1, 11, station.id, false);
  put(chars, 13, 20, station.latitude.toFixed(4), true);
  put(chars, 22, 30, station.longitude.toFixed(4), true);
  put(chars, 32, 37, String(station.elevationM ?? -999.9), true);
  put(chars, 42, 71, station.name, false);
  put(chars, 73, 76, String(station.firstYear), true);
  put(chars, 78, 81, String(station.lastYear), true);
  put(chars, 83, 88, String(station.observations), true);
  return chars.join("");
}

function soundingZip(
  id: string,
  year: number,
  month: number,
  day: number,
  hour: number,
): Uint8Array {
  const header = Array(80).fill(" ");
  header[0] = "#";
  put(header, 2, 12, id, false);
  put(header, 14, 17, String(year), true);
  put(header, 19, 20, String(month), true);
  put(header, 22, 23, String(day), true);
  put(header, 25, 26, String(hour), true);
  put(header, 33, 36, "1", true);
  put(header, 56, 62, "500078", true);
  put(header, 64, 71, "144469", true);

  const level = Array(51).fill(" ");
  put(level, 10, 15, "85000", true);
  put(level, 17, 21, "1450", true);
  put(level, 23, 27, "120", true);
  put(level, 29, 33, "650", true);
  put(level, 35, 39, "65", true);
  put(level, 41, 45, "250", true);
  put(level, 47, 51, "85", true);

  return singleFileZip(
    `${id}-data.txt`,
    Buffer.from(`${header.join("")}\n${level.join("")}\n`, "utf8"),
    8,
  );
}

function put(
  chars: string[],
  start: number,
  end: number,
  value: string,
  rightAlign: boolean,
): void {
  const width = end - start + 1;
  const fitted = rightAlign ? value.padStart(width) : value.padEnd(width);
  for (let index = 0; index < width; index += 1) {
    chars[start - 1 + index] = fitted[index] ?? " ";
  }
}

function singleFileZip(name: string, content: Buffer, method: number): Uint8Array {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = method === 8 ? deflateRawSync(content) : Buffer.from(content);

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const centralOffset = local.length + compressed.length;
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return new Uint8Array(Buffer.concat([local, compressed, central, eocd]));
}
