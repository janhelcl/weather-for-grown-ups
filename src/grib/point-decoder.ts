import type { DecodedValue, GribDecoderName } from "../types/decoded.js";
import type { GribPointSample } from "./gribberish-runtime.js";

/**
 * Decoder seam used by dataset services. `extractPoints` is optional so test
 * doubles keep working; when present, one GRIB artifact is unpacked once and
 * every coordinate is sampled from those grids.
 */
export interface GribPointDecoder {
  readonly engine?: GribDecoderName;
  extractPoint(
    path: string,
    longitude: number,
    latitude: number,
    forecastHour?: number,
  ): Promise<DecodedValue[]>;
  extractPoints?(
    path: string,
    points: readonly GribPointSample[],
    forecastHour?: number,
  ): Promise<DecodedValue[][]>;
}

export async function sampleGribPoints(
  decoder: GribPointDecoder,
  path: string,
  points: readonly GribPointSample[],
  forecastHour?: number,
): Promise<DecodedValue[][]> {
  if (points.length === 0) return [];
  if (decoder.extractPoints !== undefined && points.length > 1) {
    return decoder.extractPoints(path, points, forecastHour);
  }
  const decoded: DecodedValue[][] = [];
  for (const point of points) {
    decoded.push(await decoder.extractPoint(path, point.longitude, point.latitude, forecastHour));
  }
  return decoded;
}
