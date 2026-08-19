import { execa } from "execa";
import { ALL_SUPPORTED_GFS_CODES, type GfsCode } from "../catalog/variables.js";
import type { DecodedValue } from "../core/types.js";

const SUPPORTED_CODE_SET = new Set<string>(ALL_SUPPORTED_GFS_CODES);
const CODE_PATTERN = new RegExp(`:(${ALL_SUPPORTED_GFS_CODES.join("|")}):`);

export class Wgrib2Decoder {
  constructor(private readonly executable = process.env.WGRIB2_PATH ?? "wgrib2") {}

  async extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]> {
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
          `wgrib2 is required but was not found. Install it or set WGRIB2_PATH. Original error: ${error.message}`,
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
  const codeMatch = line.match(CODE_PATTERN);
  const pressureMatch = line.match(/:(\d+(?:\.\d+)?) mb:/);
  const surfaceMatch = line.match(/:surface:/);
  const heightMatch = line.match(/:(\d+(?:\.\d+)?) m above ground:/);
  const pointMatch = line.match(/lon=([-+\d.eE]+),lat=([-+\d.eE]+)/);
  const valueMatch = line.match(/val=([-+\d.eE]+)/);

  if (!codeMatch || (!pressureMatch && !surfaceMatch && !heightMatch) || !pointMatch || !valueMatch) return null;

  const code = codeMatch[1];
  if (!code || !SUPPORTED_CODE_SET.has(code)) return null;

  const accumulationMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour acc(?: fcst)?:/i);
  const level = pressureMatch?.[1] !== undefined
    ? { pressureHpa: Number(pressureMatch[1]) }
    : heightMatch?.[1] !== undefined
      ? { heightAboveGroundM: Number(heightMatch[1]) }
      : { surface: true as const };

  return {
    code: code as GfsCode,
    ...level,
    ...(accumulationMatch?.[1] !== undefined && accumulationMatch[2] !== undefined
      ? {
          accumulation: {
            startForecastHour: Number(accumulationMatch[1]),
            endForecastHour: Number(accumulationMatch[2]),
          },
        }
      : {}),
    value: Number(valueMatch[1]),
    gridPoint: {
      longitude: toSignedLongitude(Number(pointMatch[1])),
      latitude: Number(pointMatch[2]),
    },
  };
}

function toSignedLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
}
