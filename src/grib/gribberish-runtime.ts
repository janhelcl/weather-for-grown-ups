import { readFile } from "node:fs/promises";
import {
  parseMessagesFromBuffer,
  type GribMessage,
} from "@mattnucc/gribberish";
import type { DecodedValue, ForecastInterval } from "../core/types.js";

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

export interface GribGridStatistics {
  totalGridPoints: number;
  undefinedGridPoints: number;
  definedGridPoints: number;
  mean: number;
  min: number;
  max: number;
}

type GribCoordinateLayout = "axes" | "points";

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
  const bytes = await readFile(path);
  const messages = parseMessagesFromBuffer(bytes);
  if (messages.length === 0) throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
  return messages;
}

export function decodePointMessages(
  messages: readonly GribMessage[],
  longitude: number,
  latitude: number,
): DecodedValue[] {
  const values: DecodedValue[] = [];
  for (const message of messages) {
    const vertical = verticalFromKey(message.key);
    if (vertical === null) continue;
    const sample = nearestPoint(message, longitude, latitude);
    const interval = forecastInterval(message);
    const semantics = interval === undefined ? "instantaneous" : statisticalSemantics(message.key);
    const normalized = normalizeDecodedCodeValue(message.varAbbrev, sample.value);
    values.push({
      code: normalized.code,
      ...vertical,
      ...(semantics === "accumulation" && interval !== undefined ? { accumulation: interval } : {}),
      ...(semantics === "average" && interval !== undefined ? { average: interval } : {}),
      ...(semantics === "maximum" && interval !== undefined ? { maximum: interval } : {}),
      value: normalized.value,
      gridPoint: { latitude: sample.latitude, longitude: sample.longitude },
    });
  }
  return values;
}

export function selectMessage(
  messages: readonly GribMessage[],
  selector: GribMessageSelector,
): GribMessage {
  const matches = messages.filter((message) =>
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
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  const layout = coordinateLayout(message, coordinates.latitude, coordinates.longitude, data);
  const points: GribGridPoint[] = [];

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
        points.push({
          longitude: toSignedLongitude(pointLongitude),
          latitude: pointLatitude,
          value,
        });
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
      points.push({
        longitude: toSignedLongitude(pointLongitude),
        latitude: pointLatitude,
        value,
      });
    }
  }

  if (points.length === 0) throw new Error("Requested bbox contains no defined GFS grid points");
  return points;
}

export function summarizeMessageInBox(message: GribMessage, box: GribBox): GribGridStatistics {
  const points = gridPointsInBox(message, box);
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    sum += point.value;
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
  }
  const totalGridPoints = message.gridShape.rows * message.gridShape.cols;
  return {
    totalGridPoints,
    undefinedGridPoints: totalGridPoints - points.length,
    definedGridPoints: points.length,
    mean: sum / points.length,
    min,
    max,
  };
}

function nearestPoint(message: GribMessage, longitude: number, latitude: number): GribGridPoint {
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  const layout = coordinateLayout(message, coordinates.latitude, coordinates.longitude, data);
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


export function canonicalGribCode(code: string): string {
  const normalized = code.toUpperCase();
  if (normalized === "GP") return "HGT";
  if (normalized === "VMAX_10M") return "GUST";
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
