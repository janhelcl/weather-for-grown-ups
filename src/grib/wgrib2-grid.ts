import { execa } from "execa";
import {
  parseSelectedAreaInventoryLine,
  type AreaBox,
  type AreaMessageSelector,
  type SelectedMessageTemporal,
} from "./wgrib2-stats.js";

export interface GridValuePoint {
  longitude: number;
  latitude: number;
  value: number;
}

export interface SelectedGridValues {
  points: GridValuePoint[];
  temporal: SelectedMessageTemporal;
}

export type Wgrib2GridCommandRunner = (executable: string, args: string[]) => Promise<{ stdout: string }>;

const defaultRunner: Wgrib2GridCommandRunner = async (executable, args) => {
  const { stdout } = await execa(executable, args);
  return { stdout };
};

export class Wgrib2GridDecoder {
  constructor(
    private readonly executable = process.env.WGRIB2_PATH ?? "wgrib2",
    private readonly runner: Wgrib2GridCommandRunner = defaultRunner,
  ) {}

  async extractBox(path: string, box: AreaBox): Promise<GridValuePoint[]> {
    const inventory = await this.run([path, "-s"]);
    const records = inventory
      .split(/\r?\n/)
      .map((line) => Number(line.split(":")[0]))
      .filter((record) => Number.isInteger(record) && record >= 1);
    if (records.length !== 1) {
      throw new Error(`wgrib2 area distribution expected exactly one GRIB record, found ${records.length}`);
    }
    return this.extractRecord(path, box, records[0]!);
  }

  async extractSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridValues> {
    const inventory = await this.run([path, "-s"]);
    const matches = inventory
      .split(/\r?\n/)
      .map((line) => parseSelectedAreaInventoryLine(line, selector))
      .filter((value): value is { record: number; temporal: SelectedMessageTemporal } => value !== null);

    if (matches.length === 0) {
      throw new Error(
        `wgrib2 inventory did not contain ${selector.code} at ${selector.gribLevel} with ${selector.temporalSemantics} semantics`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `wgrib2 inventory contained ${matches.length} matching records for ${selector.code} at ${selector.gribLevel}; refusing ambiguous area distribution`,
      );
    }

    const match = matches[0]!;
    return {
      points: await this.extractRecord(path, box, match.record),
      temporal: match.temporal,
    };
  }

  private async extractRecord(path: string, box: AreaBox, record: number): Promise<GridValuePoint[]> {
    const stdout = await this.run([
      path,
      "-d",
      String(record),
      "-undefine",
      "out-box",
      `${toLongitude360(box.westLongitude)}:${toLongitude360(box.eastLongitude)}`,
      `${box.southLatitude}:${box.northLatitude}`,
      "-spread",
      "-",
    ]);
    const points = parseWgrib2Spread(stdout);
    if (points.length === 0) throw new Error("Requested bbox contains no defined GFS grid points");
    return points;
  }

  private async run(args: string[]): Promise<string> {
    try {
      return (await this.runner(this.executable, args)).stdout;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `wgrib2 is required but was not found. Install it or set WGRIB2_PATH. Original error: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

export function parseWgrib2Spread(stdout: string): GridValuePoint[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(",");
      if (parts.length < 3) return null;
      const longitude = Number(parts[0]);
      const latitude = Number(parts[1]);
      const value = Number(parts[2]);
      if (![longitude, latitude, value].every(Number.isFinite) || Math.abs(value) >= 9e19) return null;
      return { longitude: toSignedLongitude(longitude), latitude, value };
    })
    .filter((point): point is GridValuePoint => point !== null);
}

function toLongitude360(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}

function toSignedLongitude(longitude: number): number {
  const normalized = ((longitude + 540) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}
