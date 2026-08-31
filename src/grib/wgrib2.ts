import { execa } from "execa";
import { GEFS_PGRB2A_FIELD_CATALOG } from "../catalog/gefs-fields.js";
import { findNamedNonIsobaricLevel } from "../catalog/non-isobaric-fields.js";
import { ALL_SUPPORTED_GFS_CODES } from "../catalog/variables.js";
import type { DecodedValue, GribDecoderName } from "../core/types.js";
import { decodePointMessages, readGribMessages } from "./gribberish-runtime.js";

const GEFS_RAW_FIELDS = Object.values(GEFS_PGRB2A_FIELD_CATALOG).filter((definition) => definition.kind === "raw");
const ALL_SUPPORTED_CODES = [...new Set([
  ...ALL_SUPPORTED_GFS_CODES,
  ...GEFS_RAW_FIELDS.map((definition) => definition.gfsCode),
  "GP",
])];
const SUPPORTED_CODE_SET = new Set<string>(ALL_SUPPORTED_CODES);
const CODE_PATTERN = new RegExp(`:(${ALL_SUPPORTED_CODES.join("|")}):`);
const GEFS_NAMED_VERTICALS = new Set(
  GEFS_RAW_FIELDS.map((definition) => definition.level.gribLevel),
);

/**
 * Point decoder kept under its original public class name for API compatibility.
 * The default implementation is bundled through npm and needs no system executable.
 * Set WGRIB2_PATH (or WFG_DECODER=wgrib2) to opt into the legacy native wgrib2 path.
 */
export class Wgrib2Decoder {
  readonly engine: GribDecoderName;

  constructor(private readonly executable = defaultNativeExecutable()) {
    this.engine = executable === undefined ? "gribberish" : "wgrib2";
  }

  async extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]> {
    if (this.executable === undefined) {
      const decoded = decodePointMessages(await readGribMessages(path), longitude, latitude);
      if (decoded.length === 0) {
        throw new Error("Bundled GRIB2 decoder returned no supported point values");
      }
      return decoded;
    }

    let stdout: string;
    try {
      const longitude360 = ((longitude % 360) + 360) % 360;
      ({ stdout } = await execa(this.executable, [
        path,
        "-s",
        "-lon",
        String(longitude360),
        String(latitude),
      ]));
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `Native wgrib2 is required but was not found because it was explicitly requested. Install it or unset WGRIB2_PATH/WFG_DECODER. Original error: ${error.message}`,
        );
      }
      throw error;
    }

    const decoded = stdout
      .split(/\r?\n/)
      .map((line) => parseWgrib2PointLine(line))
      .filter((value): value is DecodedValue => value !== null);

    if (decoded.length === 0) {
      throw new Error(`wgrib2 returned no supported point values. Output: ${stdout.slice(0, 500)}`);
    }

    return decoded;
  }
}

export function parseWgrib2PointLine(line: string): DecodedValue | null {
  const parts = line.split(":");
  const gribLevel = parts[4] ?? "";
  const codeMatch = line.match(CODE_PATTERN);
  const pressureMatch = gribLevel.match(/^(\d+(?:\.\d+)?) mb$/);
  const surfaceMatch = gribLevel === "surface";
  const heightMatch = gribLevel.match(/^(\d+(?:\.\d+)?) m above ground$/);
  const gfsNamedLevel = findNamedNonIsobaricLevel(gribLevel);
  const modelNamedVertical = gfsNamedLevel?.gribLevel
    ?? (GEFS_NAMED_VERTICALS.has(gribLevel) ? gribLevel : undefined);
  const pointMatch = line.match(/lon=([-+\d.eE]+),lat=([-+\d.eE]+)/);
  const valueMatch = line.match(/val=([-+\d.eE]+)/);

  if (!codeMatch || (!pressureMatch && !surfaceMatch && !heightMatch && !modelNamedVertical) || !pointMatch || !valueMatch) {
    return null;
  }

  const rawCode = codeMatch[1];
  if (!rawCode || !SUPPORTED_CODE_SET.has(rawCode)) return null;
  const code = rawCode === "GP" ? "HGT" : rawCode;

  const accumulationMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour acc(?: fcst)?:/i);
  const averageMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour ave(?: fcst)?:/i);
  const level = pressureMatch?.[1] !== undefined
    ? { pressureHpa: Number(pressureMatch[1]) }
    : heightMatch?.[1] !== undefined
      ? { heightAboveGroundM: Number(heightMatch[1]) }
      : surfaceMatch
        ? { surface: true as const }
        : { namedVertical: modelNamedVertical! };

  return {
    code,
    ...level,
    ...(accumulationMatch?.[1] !== undefined && accumulationMatch[2] !== undefined
      ? {
          accumulation: {
            startForecastHour: Number(accumulationMatch[1]),
            endForecastHour: Number(accumulationMatch[2]),
          },
        }
      : {}),
    ...(averageMatch?.[1] !== undefined && averageMatch[2] !== undefined
      ? {
          average: {
            startForecastHour: Number(averageMatch[1]),
            endForecastHour: Number(averageMatch[2]),
          },
        }
      : {}),
    value: rawCode === "GP" ? Number(valueMatch[1]) / 9.80665 : Number(valueMatch[1]),
    gridPoint: {
      longitude: toSignedLongitude(Number(pointMatch[1])),
      latitude: Number(pointMatch[2]),
    },
  };
}

function defaultNativeExecutable(): string | undefined {
  if (process.env.WGRIB2_PATH) return process.env.WGRIB2_PATH;
  return process.env.WFG_DECODER === "wgrib2" ? "wgrib2" : undefined;
}

function toSignedLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
}
