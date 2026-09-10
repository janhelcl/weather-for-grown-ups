import { readFile } from "node:fs/promises";
import type { GribMessage } from "@mattnucc/gribberish";
import type { DecodedValue } from "../types/decoded.js";
import { scanGrib2Messages } from "./dwd-local-parameters.js";
import { gribDecodePool } from "./grib-decode-pool.js";
import { decodePointChunk } from "./grib-point-chunk.js";
import {
  decodePointMessagesMany,
  messagesAtForecastHour,
  parseGribMessageChunk,
  type GribPointSample,
  type SharedGribGridAxes,
} from "./gribberish-runtime.js";

/**
 * Decode point evidence without retaining expanded global grids for every
 * selected GRIB message at once.
 *
 * Provider-side byte-range subsetting removes unrequested messages, but each
 * retained message can still describe a full model grid. Parsing a profile
 * bundle wholesale therefore multiplies one expanded grid by every requested
 * variable/level (and then again by concurrent time steps). For point queries
 * we only need one scalar from each message, so parse, sample and release one
 * message at a time. Independent messages may unpack on the shared decode
 * worker pool; that is local CPU overlap, not extra provider access.
 *
 * When several coordinates share a file, each message is unpacked once and
 * every coordinate is sampled from that grid before it is released.
 */
export async function decodeBundledPointFile(
  path: string,
  longitude: number,
  latitude: number,
  forecastHour?: number,
): Promise<DecodedValue[]> {
  const [values] = await decodeBundledPointFileMany(
    path,
    [{ longitude, latitude }],
    forecastHour,
  );
  return requirePointValues(values, path);
}

export async function decodeBundledPointFileMany(
  path: string,
  points: readonly GribPointSample[],
  forecastHour?: number,
): Promise<DecodedValue[][]> {
  const bytes = await readFile(path);
  try {
    return await decodePointGribBytes(bytes, points, forecastHour);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no readable messages in buffer")) {
      throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
    }
    throw error;
  }
}

/**
 * Stream-decode GRIB bytes into per-coordinate values. Used by the file path
 * and by sources that already hold an immutable subset in memory.
 */
export async function decodePointGribBytes(
  bytes: Uint8Array,
  points: readonly GribPointSample[],
  forecastHour?: number,
): Promise<DecodedValue[][]> {
  if (points.length === 0) return [];
  const chunks = scanGrib2Messages(bytes);
  if (chunks.length === 0) {
    throw new Error("Bundled GRIB2 decoder found no readable messages in buffer");
  }

  const pool = gribDecodePool();
  if (pool.enabled && chunks.length > 1) {
    const perChunk = await Promise.all(chunks.map(async (chunk) => {
      const slice = bytes.subarray(chunk.start, chunk.end);
      try {
        return await pool.run(slice, points, forecastHour);
      } catch {
        return decodePointChunk(slice, points, forecastHour);
      }
    }));
    const merged = mergeChunkValues(perChunk, points.length);
    if (merged.every((values) => values.length === 0)) {
      throw new Error("Bundled GRIB2 decoder returned no supported point values");
    }
    return merged;
  }

  const valuesByPoint: DecodedValue[][] = points.map(() => []);
  const sharedAxes: SharedGribGridAxes = { rows: 0, cols: 0, latitude: [], longitude: [] };
  for (const chunk of chunks) {
    const selected = messagesAtForecastHourMaybe(
      parseGribMessageChunk(bytes, chunk),
      forecastHour,
    );
    if (selected.length === 0) continue;
    const decoded = decodePointMessagesMany(selected, points, sharedAxes);
    for (let index = 0; index < points.length; index += 1) {
      valuesByPoint[index]!.push(...decoded[index]!);
    }
  }
  if (valuesByPoint.every((values) => values.length === 0)) {
    throw new Error("Bundled GRIB2 decoder returned no supported point values");
  }
  return valuesByPoint;
}

function messagesAtForecastHourMaybe(
  messages: GribMessage[],
  forecastHour: number | undefined,
): GribMessage[] {
  return forecastHour === undefined ? messages : messagesAtForecastHour(messages, forecastHour);
}

function mergeChunkValues(
  perChunk: readonly DecodedValue[][][],
  pointCount: number,
): DecodedValue[][] {
  const valuesByPoint: DecodedValue[][] = Array.from({ length: pointCount }, () => []);
  for (const chunkValues of perChunk) {
    for (let index = 0; index < pointCount; index += 1) {
      const values = chunkValues[index];
      if (values !== undefined && values.length > 0) valuesByPoint[index]!.push(...values);
    }
  }
  return valuesByPoint;
}

function requirePointValues(values: DecodedValue[] | undefined, path: string): DecodedValue[] {
  if (values === undefined || values.length === 0) {
    throw new Error(
      values === undefined
        ? `Bundled GRIB2 decoder found no readable messages in ${path}`
        : "Bundled GRIB2 decoder returned no supported point values",
    );
  }
  return values;
}
