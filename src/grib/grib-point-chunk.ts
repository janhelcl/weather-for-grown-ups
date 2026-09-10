import type { DecodedValue } from "../types/decoded.js";
import {
  decodePointMessagesMany,
  messagesAtForecastHour,
  readGribMessagesFromBytes,
  type GribPointSample,
} from "./gribberish-runtime.js";

/**
 * Synchronous single-envelope decode used by worker threads. Must not re-enter
 * the worker pool.
 */
export function decodePointChunk(
  bytes: Uint8Array,
  points: readonly GribPointSample[],
  forecastHour?: number,
): DecodedValue[][] {
  const messages = readGribMessagesFromBytes(bytes);
  const selected = forecastHour === undefined
    ? messages
    : messagesAtForecastHour(messages, forecastHour);
  if (selected.length === 0) return points.map(() => []);
  return decodePointMessagesMany(selected, points);
}
