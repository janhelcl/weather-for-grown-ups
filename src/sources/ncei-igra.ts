import { WFG_USER_AGENT } from "../access/user-agent.js";
import { inflateRawSync } from "node:zlib";
import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import { runWithHttpRetry } from "../access/http-retry.js";

export const NCEI_IGRA_STATION_LIST_URL =
  "https://www.ncei.noaa.gov/pub/data/igra/igra2-station-list.txt";
export const NCEI_IGRA_DATA_BASE_URL =
  "https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/access";

export interface IgraStation {
  id: string;
  latitude: number;
  longitude: number;
  elevationM?: number;
  state?: string;
  name: string;
  firstYear: number;
  lastYear: number;
  observations: number;
}

export interface IgraSoundingLevel {
  pressureHpa: number;
  temperatureC?: number;
  relativeHumidityPct?: number;
  geopotentialHeightGpm?: number;
  windDirectionDeg?: number;
  windSpeedMs?: number;
  dewPointC?: number;
}

export interface IgraSounding {
  stationId: string;
  nominalTime: string;
  soundingLatitude: number;
  soundingLongitude: number;
  levels: IgraSoundingLevel[];
  sourceFile: string;
  cacheHit: boolean;
}

export interface NceiIgraSourceOptions {
  limiter: UpstreamAccessPolicy;
  fetchFn?: typeof fetch;
  now?: () => Date;
  retryBaseDelayMs?: number;
  retryJitterRatio?: number;
}

export interface IgraSoundingArchive {
  url: string;
  recent: boolean;
}

export class NceiIgraSource {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: NceiIgraSourceOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async listStations(): Promise<IgraStation[]> {
    return parseIgraStationList(await this.fetchStationListText());
  }

  async getSounding(stationId: string, nominalTime: Date): Promise<IgraSounding> {
    const archive = resolveIgraSoundingArchive(stationId, nominalTime, this.now());
    const text = this.extractSoundingArchive(await this.fetchSoundingArchive(archive.url));
    return {
      ...parseIgraSounding(text, stationId, nominalTime),
      sourceFile: archive.url,
      cacheHit: false,
    };
  }

  fetchStationListText(): Promise<string> {
    return this.fetchText(NCEI_IGRA_STATION_LIST_URL);
  }

  fetchSoundingArchive(url: string): Promise<Uint8Array> {
    return this.fetchBytes(url);
  }

  extractSoundingArchive(bytes: Uint8Array): string {
    return extractSingleTextFileZip(bytes);
  }

  private async fetchText(url: string): Promise<string> {
    const result = await runWithHttpRetry(
      () => this.options.limiter.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": WFG_USER_AGENT },
        });
        return {
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          statusText: response.statusText,
          text: response.ok ? await response.text() : undefined,
        };
      }),
      {
        ...(this.options.retryBaseDelayMs === undefined
          ? {}
          : { baseDelayMs: this.options.retryBaseDelayMs }),
        ...(this.options.retryJitterRatio === undefined
          ? {}
          : { jitterRatio: this.options.retryJitterRatio }),
      },
    );

    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `NOAA IGRA request failed: HTTP ${result.status} ${result.statusText} (${url})`,
      );
    }
    if (result.text === undefined) throw new Error("NOAA IGRA text response was empty");
    return result.text;
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const result = await runWithHttpRetry(
      () => this.options.limiter.run(async () => {
        const response = await this.fetchFn(url, {
          headers: { "user-agent": WFG_USER_AGENT },
        });
        return {
          status: response.status,
          retryAfter: response.headers.get("retry-after"),
          statusText: response.statusText,
          bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined,
        };
      }),
      {
        ...(this.options.retryBaseDelayMs === undefined
          ? {}
          : { baseDelayMs: this.options.retryBaseDelayMs }),
        ...(this.options.retryJitterRatio === undefined
          ? {}
          : { jitterRatio: this.options.retryJitterRatio }),
      },
    );

    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `NOAA IGRA request failed: HTTP ${result.status} ${result.statusText} (${url})`,
      );
    }
    if (result.bytes === undefined) throw new Error("NOAA IGRA binary response was empty");
    return result.bytes;
  }
}

export function resolveIgraSoundingArchive(
  stationId: string,
  nominalTime: Date,
  now: Date,
): IgraSoundingArchive {
  const year = nominalTime.getUTCFullYear();
  const currentYear = now.getUTCFullYear();
  const recent = year === currentYear;
  const filename = recent
    ? `${stationId}-data-beg${currentYear}.txt.zip`
    : `${stationId}-data.txt.zip`;
  const folder = recent ? "data-y2d" : "data-por";
  return {
    url: `${NCEI_IGRA_DATA_BASE_URL}/${folder}/${filename}`,
    recent,
  };
}

export function parseIgraStationList(text: string): IgraStation[] {
  const stations: IgraStation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length < 11) continue;
    const id = line.slice(0, 11).trim();
    const latitude = numberField(line.slice(12, 20));
    const longitude = numberField(line.slice(21, 30));
    const elevation = numberField(line.slice(31, 37));
    const firstYear = integerField(line.slice(72, 76));
    const lastYear = integerField(line.slice(77, 81));
    const observations = integerField(line.slice(82, 88));
    if (
      id.length !== 11
      || latitude === undefined
      || longitude === undefined
      || firstYear === undefined
      || lastYear === undefined
      || observations === undefined
    ) continue;
    if (latitude <= -98 || longitude <= -998) continue;

    const state = line.slice(38, 40).trim();
    stations.push({
      id,
      latitude,
      longitude,
      ...(elevation === undefined || elevation <= -998 ? {} : { elevationM: elevation }),
      ...(state.length === 0 ? {} : { state }),
      name: line.slice(41, 71).trim() || id,
      firstYear,
      lastYear,
      observations,
    });
  }
  return stations;
}

export function parseIgraSounding(
  text: string,
  stationId: string,
  nominalTime: Date,
): Omit<IgraSounding, "sourceFile" | "cacheHit"> {
  const lines = text.split(/\r?\n/);
  const target = nominalTime.toISOString();
  let headerIndex = -1;
  let numberLevels = 0;
  let soundingLatitude: number | undefined;
  let soundingLongitude: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("#") || line.slice(1, 12).trim() !== stationId) continue;
    const year = integerField(line.slice(13, 17));
    const month = integerField(line.slice(18, 20));
    const day = integerField(line.slice(21, 23));
    const hour = integerField(line.slice(24, 26));
    const levels = integerField(line.slice(32, 36));
    if (
      year === undefined
      || month === undefined
      || day === undefined
      || hour === undefined
      || levels === undefined
      || hour > 23
    ) continue;
    const time = new Date(Date.UTC(year, month - 1, day, hour)).toISOString();
    if (time !== target) continue;

    headerIndex = index;
    numberLevels = levels;
    const latRaw = integerField(line.slice(55, 62));
    const lonRaw = integerField(line.slice(63, 71));
    if (latRaw !== undefined && latRaw > -980000) soundingLatitude = latRaw / 10_000;
    if (lonRaw !== undefined && lonRaw > -9_980_000) soundingLongitude = lonRaw / 10_000;
    break;
  }

  if (headerIndex < 0) {
    throw new Error(`IGRA station ${stationId} has no sounding at ${target}`);
  }

  const levelMap = new Map<number, IgraSoundingLevel>();
  for (const line of lines.slice(headerIndex + 1, headerIndex + 1 + numberLevels)) {
    if (!line || line.startsWith("#")) break;
    const pressurePa = integerField(line.slice(9, 15));
    if (pressurePa === undefined || pressurePa <= 0) continue;
    const pressureHpa = pressurePa / 100;
    const key = Math.round(pressureHpa * 1000);
    const level = levelMap.get(key) ?? { pressureHpa };

    const geopotentialHeightGpm = integerField(line.slice(16, 21));
    const temperatureRaw = integerField(line.slice(22, 27));
    const relativeHumidityRaw = integerField(line.slice(28, 33));
    const dewPointDepressionRaw = integerField(line.slice(34, 39));
    const windDirectionDeg = integerField(line.slice(40, 45));
    const windSpeedRaw = integerField(line.slice(46, 51));

    if (geopotentialHeightGpm !== undefined) level.geopotentialHeightGpm ??= geopotentialHeightGpm;
    if (temperatureRaw !== undefined) level.temperatureC ??= temperatureRaw / 10;
    if (relativeHumidityRaw !== undefined) level.relativeHumidityPct ??= relativeHumidityRaw / 10;
    if (windDirectionDeg !== undefined && windDirectionDeg >= 0 && windDirectionDeg <= 360) {
      level.windDirectionDeg ??= windDirectionDeg;
    }
    if (windSpeedRaw !== undefined && windSpeedRaw >= 0) level.windSpeedMs ??= windSpeedRaw / 10;

    if (level.temperatureC !== undefined && dewPointDepressionRaw !== undefined && dewPointDepressionRaw >= 0) {
      level.dewPointC ??= level.temperatureC - dewPointDepressionRaw / 10;
    }
    levelMap.set(key, level);
  }

  return {
    stationId,
    nominalTime: target,
    soundingLatitude: soundingLatitude ?? Number.NaN,
    soundingLongitude: soundingLongitude ?? Number.NaN,
    levels: [...levelMap.values()].sort((a, b) => b.pressureHpa - a.pressureHpa),
  };
}

export function extractSingleTextFileZip(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const eocd = findEndOfCentralDirectory(buffer);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralOffset;

  for (let entry = 0; entry < entries; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("IGRA ZIP central directory is malformed");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (name.toLowerCase().endsWith(".txt")) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error("IGRA ZIP local file header is malformed");
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const output = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed)
          : undefined;
      if (output === undefined) throw new Error(`Unsupported IGRA ZIP compression method ${method}`);
      if (uncompressedSize !== 0 && output.length !== uncompressedSize) {
        throw new Error("IGRA ZIP extracted size does not match central directory");
      }
      return output.toString("utf8");
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("IGRA ZIP contains no sounding text file");
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("IGRA ZIP end-of-central-directory record not found");
}

function numberField(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerField(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed === -9999 || parsed === -8888 || parsed === -99999) return undefined;
  return parsed;
}

