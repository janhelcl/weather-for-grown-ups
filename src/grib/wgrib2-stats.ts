import { execa } from "execa";

export interface AreaBox {
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
}

export interface GridStatistics {
  totalGridPoints: number;
  undefinedGridPoints: number;
  definedGridPoints: number;
  mean: number;
  min: number;
  max: number;
}

export type Wgrib2CommandRunner = (executable: string, args: string[]) => Promise<{ stdout: string }>;

const defaultRunner: Wgrib2CommandRunner = async (executable, args) => {
  const { stdout } = await execa(executable, args);
  return { stdout };
};

export class Wgrib2StatsDecoder {
  constructor(
    private readonly executable = process.env.WGRIB2_PATH ?? "wgrib2",
    private readonly runner: Wgrib2CommandRunner = defaultRunner,
  ) {}

  async summarizeBox(path: string, box: AreaBox): Promise<GridStatistics> {
    let stdout: string;
    try {
      ({ stdout } = await this.runner(this.executable, [
        path,
        "-s",
        "-undefine",
        "out-box",
        `${toLongitude360(box.westLongitude)}:${toLongitude360(box.eastLongitude)}`,
        `${box.southLatitude}:${box.northLatitude}`,
        "-stats",
      ]));
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `wgrib2 is required but was not found. Install it or set WGRIB2_PATH. Original error: ${error.message}`,
        );
      }
      throw error;
    }

    const parsed = stdout
      .split(/\r?\n/)
      .map(parseWgrib2StatsLine)
      .find((value): value is GridStatistics => value !== null);
    if (!parsed) throw new Error(`wgrib2 returned no usable area statistics. Output: ${stdout.slice(0, 500)}`);
    if (parsed.definedGridPoints <= 0) throw new Error("Requested bbox contains no defined GFS grid points");
    return parsed;
  }
}

export function parseWgrib2StatsLine(line: string): GridStatistics | null {
  const ndata = fieldNumber(line, "ndata");
  const undef = fieldNumber(line, "undef");
  const mean = fieldNumber(line, "mean");
  const min = fieldNumber(line, "min");
  const max = fieldNumber(line, "max");
  if ([ndata, undef, mean, min, max].some((value) => value === null)) return null;

  const totalGridPoints = ndata as number;
  const undefinedGridPoints = undef as number;
  return {
    totalGridPoints,
    undefinedGridPoints,
    definedGridPoints: totalGridPoints - undefinedGridPoints,
    mean: mean as number,
    min: min as number,
    max: max as number,
  };
}

function fieldNumber(line: string, field: string): number | null {
  const match = line.match(new RegExp(`(?:^|:)${field}=([-+\\d.eE]+)(?=:|$)`));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function toLongitude360(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}
