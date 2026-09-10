import { readFile, stat } from "node:fs/promises";
import {
  GribMessage,
  parseMessagesFromBuffer,
} from "@mattnucc/gribberish";
import type { DecodedValue, ForecastInterval } from "../types/decoded.js";
import {
  knownDwdLocalParameter,
  scanGrib2Messages,
  type Grib2MessageSlice,
} from "./dwd-local-parameters.js";


export interface GribBox {
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
}

export interface GribMessageSelector {
  code: string;
  gribLevel: string;
  temporalSemantics: "instantaneous" | "accumulation" | "average" | "maximum";
  /**
   * Lead whose valid time (interval end for statistics) the message must carry.
   * Providers such as DWD ship sub-hourly statistical steps in one object, so
   * code + level + semantics alone can be ambiguous.
   */
  forecastHour?: number;
}

export type GribTemporal =
  | { type: "instantaneous" }
  | ({ type: "accumulation" } & ForecastInterval)
  | ({ type: "average" } & ForecastInterval)
  | ({ type: "maximum" } & ForecastInterval);

export interface GribGridPoint {
  longitude: number;
  latitude: number;
  value: number;
}

export interface GribPointSample {
  longitude: number;
  latitude: number;
}

/**
 * Reuse one regular-grid latitude/longitude axis across messages in a single
 * decode. Messages in one provider object share a grid; skipping repeated
 * axis expansion is a large saving on global products.
 */
export interface SharedGribGridAxes {
  rows: number;
  cols: number;
  latitude: readonly number[];
  longitude: readonly number[];
}

export interface GribGridStatistics {
  totalGridPoints: number;
  undefinedGridPoints: number;
  definedGridPoints: number;
  mean: number;
  min: number;
  max: number;
}

type GribCoordinateLayout = "axes" | "points";

interface ParsedGribCacheEntry {
  signature: string;
  messages: GribMessage[];
}

interface PreparedGrid {
  latitude: readonly number[];
  longitude: readonly number[];
  data: readonly number[];
  layout: GribCoordinateLayout;
}

// GRIB subset files are immutable cache artifacts in normal WFG operation. Keep a small
// in-process LRU so point/ensemble composition does not repeatedly read and parse the same
// artifact. File metadata invalidates the entry for tests or non-cache callers that replace
// a path in place.
const PARSED_GRIB_CACHE_LIMIT = 8;
const parsedGribCache = new Map<string, ParsedGribCacheEntry>();
const parsedGribInFlight = new Map<string, Promise<GribMessage[]>>();
const preparedGridCache = new WeakMap<GribMessage, PreparedGrid>();

const NAMED_VERTICAL_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["entire atmosphere as a single layer", "entire atmosphere (considered as a single layer)"],
  ["entire atmosphere as single layer", "entire atmosphere (considered as a single layer)"],
  ["entire atmosphere", "entire atmosphere"],
  ["low cloud layer", "low cloud layer"],
  ["middle cloud layer", "middle cloud layer"],
  ["high cloud layer", "high cloud layer"],
  ["convective cloud layer", "convective cloud layer"],
  ["boundary layer cloud layer", "boundary layer cloud layer"],
  ["cloud ceiling", "cloud ceiling"],
  ["cloud base above mean sea level", "cloud ceiling"],
  ["cloud base mean sea level", "cloud ceiling"],
  ["convective cloud bottom level", "convective cloud bottom level"],
  ["low cloud bottom level", "low cloud bottom level"],
  ["middle cloud bottom level", "middle cloud bottom level"],
  ["high cloud bottom level", "high cloud bottom level"],
  ["convective cloud top level", "convective cloud top level"],
  ["low cloud top level", "low cloud top level"],
  ["middle cloud top level", "middle cloud top level"],
  ["high cloud top level", "high cloud top level"],
  ["mean sea level", "mean sea level"],
];

export async function readGribMessages(path: string): Promise<GribMessage[]> {
  const info = await stat(path);
  const signature = `${info.size}:${info.mtimeMs}`;
  const cached = parsedGribCache.get(path);
  if (cached?.signature === signature) {
    // Refresh LRU position without copying the parsed messages.
    parsedGribCache.delete(path);
    parsedGribCache.set(path, cached);
    return cached.messages;
  }

  const inFlightKey = `${path}:${signature}`;
  const pending = parsedGribInFlight.get(inFlightKey);
  if (pending !== undefined) return pending;

  const operation = (async () => {
    const bytes = await readFile(path);
    const messages = parseMessagesWithKnownLocalAliases(bytes);
    if (messages.length === 0) {
      throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
    }
    parsedGribCache.delete(path);
    parsedGribCache.set(path, { signature, messages });
    while (parsedGribCache.size > PARSED_GRIB_CACHE_LIMIT) {
      const oldest = parsedGribCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      parsedGribCache.delete(oldest);
    }
    return messages;
  })().finally(() => parsedGribInFlight.delete(inFlightKey));

  parsedGribInFlight.set(inFlightKey, operation);
  return operation;
}

export function readGribMessagesFromBytes(bytes: Uint8Array): GribMessage[] {
  const messages = parseMessagesWithKnownLocalAliases(bytes);
  if (messages.length === 0) throw new Error("Bundled GRIB2 decoder found no readable messages in buffer");
  return messages;
}

/**
 * gribberish intentionally follows the WMO parameter tables and can drop
 * DWD-local parameters before exposing a GribMessage. Rewrite only the
 * parameter metadata of known local messages to parseable surrogates, then
 * restore the provider code at the WFG normalization
 * boundary. Grid values, level metadata, reference time, and accumulation
 * intervals remain byte-for-byte unchanged.
 */
function parseMessagesWithKnownLocalAliases(bytes: Uint8Array): GribMessage[] {
  const chunks = scanGrib2Messages(bytes);
  const locals = chunks.map((chunk) =>
    knownDwdLocalParameter(
      chunk.discipline,
      chunk.center,
      chunk.category,
      chunk.parameter,
      chunk.firstFixedSurfaceType,
    ));
  if (!locals.some((local) => local !== undefined)) {
    return parseMessagesFromBuffer(bytes);
  }

  const messages: GribMessage[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const local = locals[index];
    const chunkBytes = Uint8Array.from(bytes.subarray(chunk.start, chunk.end));
    if (
      local !== undefined
      && chunk.categoryOffset !== undefined
      && chunk.parameterOffset !== undefined
    ) {
      chunkBytes[chunk.categoryOffset - chunk.start] = local.surrogate[0];
      chunkBytes[chunk.parameterOffset - chunk.start] = local.surrogate[1];
    }

    const parsed = parseMessagesFromBuffer(chunkBytes);
    if (local !== undefined && parsed.length === 0) {
      throw new Error(
        `Bundled GRIB2 decoder could not normalize DWD local parameter ${local.alias}`,
      );
    }
    messages.push(...parsed.map((message) =>
      local === undefined ? message : withGribCodeAlias(message, local.alias)));
  }
  return messages;
}

function withGribCodeAlias(message: GribMessage, alias: string): GribMessage {
  return new Proxy(message, {
    get(target, property) {
      if (property === "varAbbrev") return alias;
      if (property === "key") {
        const key = Reflect.get(target, property, target) as string;
        const separator = key.indexOf(":");
        return separator < 0 ? alias : `${alias}${key.slice(separator)}`;
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Parse one scanned GRIB2 envelope. Point decoding uses this so a profile
 * bundle never materializes every expanded grid at once.
 */
export function parseGribMessageChunk(fileBytes: Uint8Array, chunk: Grib2MessageSlice): GribMessage[] {
  const local = knownDwdLocalParameter(
    chunk.discipline,
    chunk.center,
    chunk.category,
    chunk.parameter,
    chunk.firstFixedSurfaceType,
  );
  if (
    local !== undefined
    && chunk.categoryOffset !== undefined
    && chunk.parameterOffset !== undefined
  ) {
    const chunkBytes = Uint8Array.from(fileBytes.subarray(chunk.start, chunk.end));
    chunkBytes[chunk.categoryOffset - chunk.start] = local.surrogate[0];
    chunkBytes[chunk.parameterOffset - chunk.start] = local.surrogate[1];
    const parsed = parseMessagesFromBuffer(chunkBytes);
    if (parsed.length === 0) {
      throw new Error(
        `Bundled GRIB2 decoder could not normalize DWD local parameter ${local.alias}`,
      );
    }
    return parsed.map((message) => withGribCodeAlias(message, local.alias));
  }

  try {
    return [GribMessage.parseFromBuffer(fileBytes, chunk.start)];
  } catch {
    return parseMessagesFromBuffer(fileBytes.subarray(chunk.start, chunk.end));
  }
}

export function messagesAtForecastHour(
  messages: readonly GribMessage[],
  forecastHour: number,
): GribMessage[] {
  return messages.filter((message) => {
    const target = message.forecastEndDate ?? message.forecastDate;
    return roundedHours(target.getTime() - message.referenceDate.getTime()) === forecastHour;
  });
}

export function decodePointMessages(
  messages: readonly GribMessage[],
  longitude: number,
  latitude: number,
  sharedAxes?: SharedGribGridAxes,
): DecodedValue[] {
  return decodePointMessagesMany(messages, [{ longitude, latitude }], sharedAxes)[0] ?? [];
}

/**
 * Unpack each message once and sample every requested coordinate from that
 * expanded grid. Multi-point and transect composition should use this instead
 * of calling {@link decodePointMessages} per coordinate.
 */
export function decodePointMessagesMany(
  messages: readonly GribMessage[],
  points: readonly GribPointSample[],
  sharedAxes?: SharedGribGridAxes,
): DecodedValue[][] {
  const valuesByPoint: DecodedValue[][] = points.map(() => []);
  if (points.length === 0) return valuesByPoint;
  const axes = sharedAxes ?? { rows: 0, cols: 0, latitude: [], longitude: [] };

  for (const message of messages) {
    const vertical = decodedVertical(message);
    if (vertical === null) continue;
    const prepared = preparedGrid(message, axes);
    const interval = forecastInterval(message);
    const semantics = interval === undefined ? "instantaneous" : statisticalSemantics(message.key);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      const sample = nearestPointFromPrepared(message, prepared, point.longitude, point.latitude);
      const normalizedValue = normalizeDecodedCodeValue(message.varAbbrev, sample.value);
      valuesByPoint[index]!.push({
        code: normalizedValue.code,
        ...vertical,
        ...(semantics === "accumulation" && interval !== undefined ? { accumulation: interval } : {}),
        ...(semantics === "average" && interval !== undefined ? { average: interval } : {}),
        ...(semantics === "maximum" && interval !== undefined ? { maximum: interval } : {}),
        value: normalizedValue.value,
        gridPoint: { latitude: sample.latitude, longitude: sample.longitude },
      });
    }
  }
  return valuesByPoint;
}

function decodedVertical(
  message: GribMessage,
): Omit<DecodedValue, "code" | "value" | "gridPoint" | "accumulation" | "average" | "maximum"> | null {
  const normalized = normalizeDecodedCodeValue(message.varAbbrev, 0);
  if (normalized.code === "CEILING") return { namedVertical: "cloud ceiling" };
  if (isDwdMslHeightCode(normalized.code)) return { namedVertical: "mean sea level" };
  if (isDwdMeanLayerCode(normalized.code)) return { namedVertical: "mean layer" };
  if (isDwdUpdraftHelicityCode(normalized.code)) {
    return { namedVertical: "2-8 km above mean sea level" };
  }
  return verticalFromKey(message.key);
}

export function selectMessage(
  messages: readonly GribMessage[],
  selector: GribMessageSelector,
): GribMessage {
  const candidates = selector.forecastHour === undefined
    ? messages
    : messagesAtForecastHour(messages, selector.forecastHour);
  const matches = candidates.filter((message) =>
    canonicalGribCode(message.varAbbrev) === selector.code
    && matchesGribLevel(message.key, selector.gribLevel)
    && matchesTemporalSemantics(message, selector.temporalSemantics));
  if (matches.length === 0) {
    throw new Error(
      `Bundled GRIB2 decoder did not contain ${selector.code} at ${selector.gribLevel} with ${selector.temporalSemantics} semantics`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Bundled GRIB2 decoder found ${matches.length} matching messages for ${selector.code} at ${selector.gribLevel}; refusing ambiguous selection`,
    );
  }
  return matches[0]!;
}

export function temporalForSelector(message: GribMessage, selector: GribMessageSelector): GribTemporal {
  if (selector.temporalSemantics === "instantaneous") return { type: "instantaneous" };
  const interval = forecastInterval(message);
  if (interval === undefined) {
    throw new Error(
      `Bundled GRIB2 decoder selected ${selector.code} at ${selector.gribLevel} without a forecast interval`,
    );
  }
  return { type: selector.temporalSemantics, ...interval };
}

export function gridPointsInBox(message: GribMessage, box: GribBox): GribGridPoint[] {
  const points: GribGridPoint[] = [];
  forEachDefinedPointInBox(message, box, (longitude, latitude, value) => {
    points.push({ longitude, latitude, value });
  });
  if (points.length === 0) throw new Error("Requested bbox contains no defined GFS grid points");
  return points;
}

export function summarizeMessageInBox(message: GribMessage, box: GribBox): GribGridStatistics {
  let definedGridPoints = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  forEachDefinedPointInBox(message, box, (_longitude, _latitude, value) => {
    definedGridPoints += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  if (definedGridPoints === 0) throw new Error("Requested bbox contains no defined GFS grid points");
  const totalGridPoints = message.gridShape.rows * message.gridShape.cols;
  return {
    totalGridPoints,
    undefinedGridPoints: totalGridPoints - definedGridPoints,
    definedGridPoints,
    mean: sum / definedGridPoints,
    min,
    max,
  };
}

function forEachDefinedPointInBox(
  message: GribMessage,
  box: GribBox,
  visit: (longitude: number, latitude: number, value: number) => void,
): void {
  const prepared = preparedGrid(message);
  const coordinates = { latitude: prepared.latitude, longitude: prepared.longitude };
  const data = prepared.data;
  const layout = prepared.layout;

  if (layout === "axes") {
    const { rows, cols } = message.gridShape;
    for (let row = 0; row < rows; row += 1) {
      const pointLatitude = coordinates.latitude[row];
      if (
        pointLatitude === undefined
        || !Number.isFinite(pointLatitude)
        || pointLatitude < box.southLatitude
        || pointLatitude > box.northLatitude
      ) continue;
      for (let col = 0; col < cols; col += 1) {
        const pointLongitude = coordinates.longitude[col];
        if (
          pointLongitude === undefined
          || !Number.isFinite(pointLongitude)
          || !contains(box, pointLongitude, pointLatitude)
        ) continue;
        const value = data[row * cols + col];
        if (value === undefined || !Number.isFinite(value)) continue;
        visit(toSignedLongitude(pointLongitude), pointLatitude, value);
      }
    }
  } else {
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index];
      const pointLatitude = coordinates.latitude[index];
      const pointLongitude = coordinates.longitude[index];
      if (
        value === undefined
        || pointLatitude === undefined
        || pointLongitude === undefined
        || !Number.isFinite(value)
        || !Number.isFinite(pointLatitude)
        || !Number.isFinite(pointLongitude)
        || !contains(box, pointLongitude, pointLatitude)
      ) continue;
      visit(toSignedLongitude(pointLongitude), pointLatitude, value);
    }
  }
}

function nearestPointFromPrepared(
  message: GribMessage,
  prepared: PreparedGrid,
  longitude: number,
  latitude: number,
): GribGridPoint {
  const coordinates = { latitude: prepared.latitude, longitude: prepared.longitude };
  const data = prepared.data;
  const layout = prepared.layout;
  const targetLongitude = toSignedLongitude(longitude);

  if (layout === "axes") {
    const latitudeIndex = nearestAxisIndex(
      coordinates.latitude,
      (value) => Math.abs(value - latitude),
    );
    const longitudeIndex = nearestAxisIndex(
      coordinates.longitude,
      (value) => Math.abs(wrappedLongitudeDelta(toSignedLongitude(value), targetLongitude)),
    );
    if (latitudeIndex < 0 || longitudeIndex < 0) {
      throw new Error("Bundled GRIB2 decoder found no grid coordinates");
    }
    const pointLatitude = coordinates.latitude[latitudeIndex];
    const pointLongitude = coordinates.longitude[longitudeIndex];
    const value = data[latitudeIndex * message.gridShape.cols + longitudeIndex];
    if (
      value === undefined
      || pointLatitude === undefined
      || pointLongitude === undefined
      || !Number.isFinite(value)
    ) {
      throw new Error("Nearest GRIB2 grid point is undefined for the requested field");
    }
    return {
      longitude: toSignedLongitude(pointLongitude),
      latitude: pointLatitude,
      value,
    };
  }

  const longitudeWeight = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < data.length; index += 1) {
    const pointLatitude = coordinates.latitude[index];
    const pointLongitude = coordinates.longitude[index];
    if (
      pointLatitude === undefined
      || pointLongitude === undefined
      || !Number.isFinite(pointLatitude)
      || !Number.isFinite(pointLongitude)
    ) continue;
    const deltaLatitude = pointLatitude - latitude;
    const deltaLongitude = wrappedLongitudeDelta(toSignedLongitude(pointLongitude), targetLongitude);
    const score = deltaLatitude * deltaLatitude + (deltaLongitude * longitudeWeight) ** 2;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) throw new Error("Bundled GRIB2 decoder found no grid coordinates");
  const value = data[bestIndex];
  const pointLatitude = coordinates.latitude[bestIndex];
  const pointLongitude = coordinates.longitude[bestIndex];
  if (
    value === undefined
    || pointLatitude === undefined
    || pointLongitude === undefined
    || !Number.isFinite(value)
  ) {
    throw new Error("Nearest GRIB2 grid point is undefined for the requested field");
  }
  return {
    longitude: toSignedLongitude(pointLongitude),
    latitude: pointLatitude,
    value,
  };
}

function nearestAxisIndex(values: readonly number[], distance: (value: number) => number): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) continue;
    const candidateDistance = distance(value);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function preparedGrid(message: GribMessage, sharedAxes?: SharedGribGridAxes): PreparedGrid {
  const cached = preparedGridCache.get(message);
  if (cached !== undefined) return cached;
  // Do not roll a global [0, 360) longitude axis into [-180, 180). Rolling
  // copies the unpacked field; nearest-neighbour search already wraps.
  const data = message.dataAdjusted(false, false);
  const { rows, cols } = message.gridShape;
  let latitude: readonly number[];
  let longitude: readonly number[];
  if (
    sharedAxes !== undefined
    && sharedAxes.rows === rows
    && sharedAxes.cols === cols
    && sharedAxes.latitude.length > 0
    && message.isRegularGrid === true
  ) {
    latitude = sharedAxes.latitude;
    longitude = sharedAxes.longitude;
  } else {
    const coordinates = message.latlngAdjusted(false, false);
    latitude = coordinates.latitude;
    longitude = coordinates.longitude;
    if (sharedAxes !== undefined && message.isRegularGrid === true) {
      sharedAxes.rows = rows;
      sharedAxes.cols = cols;
      sharedAxes.latitude = latitude;
      sharedAxes.longitude = longitude;
    }
  }
  const prepared: PreparedGrid = {
    latitude,
    longitude,
    data,
    layout: coordinateLayout(message, latitude, longitude, data),
  };
  preparedGridCache.set(message, prepared);
  return prepared;
}

function coordinateLayout(
  message: GribMessage,
  latitudes: readonly number[],
  longitudes: readonly number[],
  data: readonly number[],
): GribCoordinateLayout {
  const { rows, cols } = message.gridShape;
  const expected = rows * cols;
  if (data.length === expected && latitudes.length === expected && longitudes.length === expected) {
    return "points";
  }
  if (data.length === expected && latitudes.length === rows && longitudes.length === cols) {
    return "axes";
  }
  throw new Error(
    `Bundled GRIB2 decoder returned misaligned grid arrays (${latitudes.length}/${longitudes.length}/${data.length}, expected points=${expected} or axes=${rows}/${cols})`,
  );
}

function verticalFromKey(key: string): Omit<DecodedValue, "code" | "value" | "gridPoint" | "accumulation" | "average" | "maximum"> | null {
  const pressureMatch = key.match(/:([-+]?\d+(?:\.\d+)?) in mb(?=:|$)/i);
  if (pressureMatch?.[1] !== undefined) {
    const rawPressure = Number(pressureMatch[1]);
    return { pressureHpa: rawPressure > 2_000 ? rawPressure / 100 : rawPressure };
  }
  const heightMatch = key.match(/:([-+]?\d+(?:\.\d+)?) in above ground(?=:|$)/i);
  if (heightMatch?.[1] !== undefined) return { heightAboveGroundM: Number(heightMatch[1]) };
  // The second fixed surface's scaled value may be 0 or missing (DWD
  // ICON-D2-EPS encodes it as missing), so accept an empty value too.
  if (/:\s*(?:0\s+)?in surface:\s*(?:0\s+)?in top of atmosphere(?=:|$)/i.test(key)) {
    return { namedVertical: "entire atmosphere" };
  }
  if (/:\s*(?:0\s+)?in surface(?=:|$)/i.test(key)) return { surface: true };

  const pressureDifferenceMatch = key.match(
    /:([-+]?\d+(?:\.\d+)?) in level at specified pressure difference from ground to level(?::([-+]?\d+(?:\.\d+)?) in level at specified pressure difference from ground to level)?/i,
  );
  if (pressureDifferenceMatch?.[1] !== undefined) {
    const first = normalizedPressureDifference(Number(pressureDifferenceMatch[1]));
    const second = pressureDifferenceMatch[2] === undefined
      ? 0
      : normalizedPressureDifference(Number(pressureDifferenceMatch[2]));
    return { namedVertical: `${first}-${second} mb above ground` };
  }

  const normalizedKey = normalizeNamedVerticalText(key);
  for (const [decoderName, publicName] of NAMED_VERTICAL_ALIASES) {
    if (normalizedKey.includes(`in${normalizeNamedVerticalText(decoderName)}`)) {
      return { namedVertical: publicName };
    }
  }
  return null;
}

function normalizeNamedVerticalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesGribLevel(key: string, gribLevel: string): boolean {
  const decoded = verticalFromKey(key);
  if (decoded === null) return false;
  const pressureMatch = gribLevel.match(/^([-+]?\d+(?:\.\d+)?) mb$/i);
  if (pressureMatch?.[1] !== undefined) return decoded.pressureHpa === Number(pressureMatch[1]);
  const heightMatch = gribLevel.match(/^([-+]?\d+(?:\.\d+)?) m above ground$/i);
  if (heightMatch?.[1] !== undefined) return decoded.heightAboveGroundM === Number(heightMatch[1]);
  if (gribLevel === "surface") return decoded.surface === true;
  return decoded.namedVertical === gribLevel;
}

function matchesTemporalSemantics(
  message: GribMessage,
  semantics: GribMessageSelector["temporalSemantics"],
): boolean {
  if (message.forecastEndDate === null) return semantics === "instantaneous";
  return statisticalSemantics(message.key) === semantics;
}

function statisticalSemantics(key: string): "accumulation" | "average" | "maximum" | undefined {
  const lowerKey = key.toLowerCase();
  if (/(?:^|[: ])(?:acc|accumulation)(?:[ :]|$)/.test(lowerKey)) return "accumulation";
  if (/(?:^|[: ])(?:avg|average)(?:[ :]|$)/.test(lowerKey)) return "average";
  if (/(?:^|[: ])(?:max|maximum)(?:[ :]|$)/.test(lowerKey)) return "maximum";
  return undefined;
}

function forecastInterval(message: GribMessage): ForecastInterval | undefined {
  const end = message.forecastEndDate;
  if (end === null) return undefined;
  const reference = message.referenceDate.getTime();
  return {
    startForecastHour: roundedHours(message.forecastDate.getTime() - reference),
    endForecastHour: roundedHours(end.getTime() - reference),
  };
}

function roundedHours(milliseconds: number): number {
  const hours = milliseconds / 3_600_000;
  const rounded = Math.round(hours * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizedPressureDifference(value: number): number {
  const normalized = value > 2_000 ? value / 100 : value;
  return Math.round(normalized * 1_000_000) / 1_000_000;
}

function contains(box: GribBox, longitude: number, latitude: number): boolean {
  if (latitude < box.southLatitude || latitude > box.northLatitude) return false;
  const signedLongitude = toSignedLongitude(longitude);
  const west = toSignedLongitude(box.westLongitude);
  const east = toSignedLongitude(box.eastLongitude);
  return west <= east
    ? signedLongitude >= west && signedLongitude <= east
    : signedLongitude >= west || signedLongitude <= east;
}

function wrappedLongitudeDelta(left: number, right: number): number {
  const delta = left - right;
  return ((delta + 540) % 360) - 180;
}

function toSignedLongitude(longitude: number): number {
  const normalized = ((longitude + 540) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}


function isDwdMslHeightCode(code: string): boolean {
  return code === "HBAS_SC" || code === "HTOP_SC" || code === "HTOP_DC";
}

function isDwdMeanLayerCode(code: string): boolean {
  return code === "CAPE_ML" || code === "CIN_ML";
}

function isDwdUpdraftHelicityCode(code: string): boolean {
  return code === "UH_MAX";
}

export function canonicalGribCode(code: string): string {
  const normalized = code.toUpperCase();
  if (normalized === "GP") return "HGT";
  // gribberish abbreviates WMO total precipitation (0-1-8) as TP; the shared
  // field vocabulary and wgrib2 inventories use APCP.
  if (normalized === "TP") return "APCP";
  if (normalized === "VMAX_10M") return "GUST";
  if (normalized === "CEIL") return "CEILING";
  if (normalized === "U_RAF" || normalized === "UGUST" || normalized === "EFG10") return "U_RAF";
  if (normalized === "V_RAF" || normalized === "VGUST" || normalized === "NFG10") return "V_RAF";
  return code;
}

function normalizeDecodedCodeValue(code: string, value: number): { code: string; value: number } {
  // DWD ICON pressure-level FI is GRIB geopotential (GP, m²/s²), while the
  // normalized atmospheric vocabulary uses geopotential height (HGT, gpm).
  return {
    code: canonicalGribCode(code),
    value: code === "GP" ? value / 9.80665 : value,
  };
}
