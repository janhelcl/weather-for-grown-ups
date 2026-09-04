import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  NceiIgraSource,
  extractSingleTextFileZip,
  parseIgraSounding,
  parseIgraStationList,
} from "../src/sources/ncei-igra.js";

describe("IGRA transport retry", () => {
  it("retries a transient socket close before returning a successful response", async () => {
    const fetchFn = vi.fn(async () => {
      if (fetchFn.mock.calls.length === 1) {
        const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
        error.cause = { code: "UND_ERR_SOCKET" };
        throw error;
      }
      return new Response(stationLine({
        id: "EZM00011520",
        latitude: "50.0078",
        longitude: "14.4469",
        elevation: "302.0",
        name: "PRAHA-LIBUS",
        firstYear: "1969",
        lastYear: "2026",
        observations: "70000",
      }), { status: 200 });
    });
    const limiter = {
      run: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    };
    const source = new NceiIgraSource({
      limiter: limiter as any,
      fetchFn: fetchFn as any,
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
    });

    const stations = await source.listStations();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(stations[0]).toMatchObject({
      id: "EZM00011520",
      name: "PRAHA-LIBUS",
    });
  });
});

describe("IGRA station list", () => {
  it("parses fixed-width station metadata", () => {
    const text = stationLine({
      id: "EZM00011520",
      latitude: "50.0078",
      longitude: "14.4469",
      elevation: "302.0",
      name: "PRAHA-LIBUS",
      firstYear: "1969",
      lastYear: "2026",
      observations: "70000",
    });

    expect(parseIgraStationList(text)).toEqual([{
      id: "EZM00011520",
      latitude: 50.0078,
      longitude: 14.4469,
      elevationM: 302,
      name: "PRAHA-LIBUS",
      firstYear: 1969,
      lastYear: 2026,
      observations: 70000,
    }]);
  });

  it("drops mobile/sentinel locations from nearest-station catalog use", () => {
    expect(parseIgraStationList(stationLine({
      id: "ZZXUAICE001",
      latitude: "-98.8888",
      longitude: "-998.8888",
      elevation: "-998.8",
      name: "MOBILE",
      firstYear: "2020",
      lastYear: "2026",
      observations: "100",
    }))).toEqual([]);
  });
});

describe("IGRA sounding parser", () => {
  it("extracts one exact nominal sounding and normalizes units", () => {
    const text = [
      soundingHeader("EZM00011520", 2026, 8, 24, 0, 1, 500078, 144469),
      soundingLevel({
        pressurePa: 85000,
        heightM: 1450,
        temperatureTenthsC: 120,
        relativeHumidityTenthsPct: 650,
        dewPointDepressionTenthsC: 65,
        windDirectionDeg: 250,
        windSpeedTenthsMs: 85,
      }),
      soundingHeader("EZM00011520", 2026, 8, 24, 12, 2, 500078, 144469),
      soundingLevel({
        pressurePa: 85000,
        heightM: 1475,
        temperatureTenthsC: 145,
        relativeHumidityTenthsPct: -9999,
        dewPointDepressionTenthsC: 55,
        windDirectionDeg: 260,
        windSpeedTenthsMs: 95,
      }),
      soundingLevel({
        pressurePa: 70000,
        heightM: 3100,
        temperatureTenthsC: 20,
        relativeHumidityTenthsPct: 400,
        dewPointDepressionTenthsC: 80,
        windDirectionDeg: 275,
        windSpeedTenthsMs: 120,
      }),
    ].join("\n");

    const result = parseIgraSounding(
      text,
      "EZM00011520",
      new Date("2026-08-24T12:00:00Z"),
    );

    expect(result.nominalTime).toBe("2026-08-24T12:00:00.000Z");
    expect(result.soundingLatitude).toBeCloseTo(50.0078);
    expect(result.soundingLongitude).toBeCloseTo(14.4469);
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0]).toMatchObject({
      pressureHpa: 850,
      geopotentialHeightGpm: 1475,
      temperatureC: 14.5,
      windDirectionDeg: 260,
      windSpeedMs: 9.5,
      dewPointC: 9,
    });
    expect(result.levels[0]).not.toHaveProperty("relativeHumidityPct");
  });

  it("fails explicitly when the nominal sounding is absent", () => {
    const text = [
      soundingHeader("EZM00011520", 2026, 8, 24, 0, 0, 500078, 144469),
    ].join("\n");

    expect(() => parseIgraSounding(
      text,
      "EZM00011520",
      new Date("2026-08-24T12:00:00Z"),
    )).toThrow(/no sounding/);
  });
});

describe("IGRA ZIP extraction", () => {
  it("extracts the station text file using Node zlib only", () => {
    const text = "#example\n10 example sounding line\n";
    const zip = singleFileZip("EZM00011520-data.txt", Buffer.from(text, "utf8"));

    expect(extractSingleTextFileZip(zip)).toBe(text);
  });
});

function stationLine(input: {
  id: string;
  latitude: string;
  longitude: string;
  elevation: string;
  name: string;
  firstYear: string;
  lastYear: string;
  observations: string;
}): string {
  const chars = Array(88).fill(" ");
  put(chars, 1, 11, input.id, false);
  put(chars, 13, 20, input.latitude, true);
  put(chars, 22, 30, input.longitude, true);
  put(chars, 32, 37, input.elevation, true);
  put(chars, 42, 71, input.name, false);
  put(chars, 73, 76, input.firstYear, true);
  put(chars, 78, 81, input.lastYear, true);
  put(chars, 83, 88, input.observations, true);
  return chars.join("");
}

function soundingHeader(
  id: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  numberLevels: number,
  latitudeTenThousandths: number,
  longitudeTenThousandths: number,
): string {
  const chars = Array(80).fill(" ");
  chars[0] = "#";
  put(chars, 2, 12, id, false);
  put(chars, 14, 17, String(year), true);
  put(chars, 19, 20, String(month), true);
  put(chars, 22, 23, String(day), true);
  put(chars, 25, 26, String(hour), true);
  put(chars, 33, 36, String(numberLevels), true);
  put(chars, 56, 62, String(latitudeTenThousandths), true);
  put(chars, 64, 71, String(longitudeTenThousandths), true);
  return chars.join("");
}

function soundingLevel(input: {
  pressurePa: number;
  heightM: number;
  temperatureTenthsC: number;
  relativeHumidityTenthsPct: number;
  dewPointDepressionTenthsC: number;
  windDirectionDeg: number;
  windSpeedTenthsMs: number;
}): string {
  const chars = Array(51).fill(" ");
  put(chars, 1, 1, "1", true);
  put(chars, 2, 2, "0", true);
  put(chars, 4, 8, "0", true);
  put(chars, 10, 15, String(input.pressurePa), true);
  put(chars, 17, 21, String(input.heightM), true);
  put(chars, 23, 27, String(input.temperatureTenthsC), true);
  put(chars, 29, 33, String(input.relativeHumidityTenthsPct), true);
  put(chars, 35, 39, String(input.dewPointDepressionTenthsC), true);
  put(chars, 41, 45, String(input.windDirectionDeg), true);
  put(chars, 47, 51, String(input.windSpeedTenthsMs), true);
  return chars.join("");
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

function singleFileZip(name: string, content: Buffer): Uint8Array {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const centralOffset = local.length + compressed.length;
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
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
