import { readFile } from "node:fs/promises";
import type { DecodedValue } from "../types/decoded.js";
import { scanGrib2Messages } from "./dwd-local-parameters.js";
import {
  decodePointMessages,
  messagesAtForecastHour,
  readGribMessagesFromBytes,
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
 * message at a time.
 */
export async function decodeBundledPointFile(
  path: string,
  longitude: number,
  latitude: number,
  forecastHour?: number,
): Promise<DecodedValue[]> {
  const bytes = await readFile(path);
  const chunks = scanGrib2Messages(bytes);
  if (chunks.length === 0) {
    throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
  }

  const values: DecodedValue[] = [];
  for (const chunk of chunks) {
    // subarray is intentionally zero-copy. readGribMessagesFromBytes creates a
    // private copy only when it must rewrite a known provider-local parameter.
    const messages = readGribMessagesFromBytes(bytes.subarray(chunk.start, chunk.end));
    const selected = forecastHour === undefined
      ? messages
      : messagesAtForecastHour(messages, forecastHour);
    if (selected.length === 0) continue;
    values.push(...decodePointMessages(selected, longitude, latitude));
  }

  if (values.length === 0) {
    throw new Error("Bundled GRIB2 decoder returned no supported point values");
  }
  return values;
}
