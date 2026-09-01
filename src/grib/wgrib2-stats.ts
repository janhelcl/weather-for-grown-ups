import { execa } from "execa";
import type { FieldTemporalSemantics } from "../catalog/non-isobaric-fields.js";
import type { GfsCode } from "../catalog/variables.js";
import type { ForecastInterval, GribDecoderName } from "../core/types.js";
import {
  canonicalGribCode,
  readGribMessages,
  selectMessage,
  summarizeMessageInBox,
  temporalForSelector,
} from "./gribberish-runtime.js";

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

export interface AreaMessageSelector {
  code: GfsCode;
  gribLevel: string;
  temporalSemantics: FieldTemporalSemantics;
}

export type SelectedMessageTemporal =
  | { type: "instantaneous" }
  | ({ type: "accumulation" } & ForecastInterval)
  | ({ type: "average" } & ForecastInterval)
  | ({ type: "maximum" } & ForecastInterval);

export interface SelectedGridStatistics extends GridStatistics {
  temporal: SelectedMessageTemporal;
}

export type Wgrib2CommandRunner = (executable: string, args: string[]) => Promise<{ stdout: string }>;

const defaultRunner: Wgrib2CommandRunner = async (executable, args) => {
  const { stdout } = await execa(executable, args);
  return { stdout };
};

/**
 * Area statistics decoder. The class name remains for compatibility, but the
 * default path is the npm-bundled GRIB2 decoder. Native wgrib2 is opt-in via
 * WGRIB2_PATH or WFG_DECODER=wgrib2.
 */
export class Wgrib2StatsDecoder {
  readonly engine: GribDecoderName;

  constructor(
    private readonly executable = defaultNativeExecutable(),
    private readonly runner: Wgrib2CommandRunner = defaultRunner,
  ) {
    this.engine = executable === undefined ? "gribberish" : "wgrib2";
  }

  async summarizeBox(path: string, box: AreaBox): Promise<GridStatistics> {
    if (this.executable === undefined) {
      const messages = await readGribMessages(path);
      if (messages.length !== 1) {
        throw new Error(`Bundled GRIB2 area distribution expected exactly one GRIB record, found ${messages.length}`);
      }
      return summarizeMessageInBox(messages[0]!, box);
    }

    const stdout = await this.run([
      path,
      "-s",
      "-undefine",
      "out-box",
      `${toLongitude360(box.westLongitude)}:${toLongitude360(box.eastLongitude)}`,
      `${box.southLatitude}:${box.northLatitude}`,
      "-stats",
    ]);
    return parseSingleStats(stdout);
  }

  async summarizeSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridStatistics> {
    if (this.executable === undefined) {
      const message = selectMessage(await readGribMessages(path), selector);
      return {
        ...summarizeMessageInBox(message, box),
        temporal: temporalForSelector(message, selector),
      };
    }

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
        `wgrib2 inventory contained ${matches.length} matching records for ${selector.code} at ${selector.gribLevel}; refusing ambiguous area statistics`,
      );
    }

    const match = matches[0]!;
    const stdout = await this.run([
      path,
      "-d",
      String(match.record),
      "-undefine",
      "out-box",
      `${toLongitude360(box.westLongitude)}:${toLongitude360(box.eastLongitude)}`,
      `${box.southLatitude}:${box.northLatitude}`,
      "-stats",
    ]);
    return { ...parseSingleStats(stdout), temporal: match.temporal };
  }

  private async run(args: string[]): Promise<string> {
    if (this.executable === undefined) throw new Error("Internal error: native wgrib2 path is not configured");
    try {
      const { stdout } = await this.runner(this.executable, args);
      return stdout;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `Native wgrib2 is required but was not found because it was explicitly requested. Install it or unset WGRIB2_PATH/WFG_DECODER. Original error: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

export function parseSelectedAreaInventoryLine(
  line: string,
  selector: AreaMessageSelector,
): { record: number; temporal: SelectedMessageTemporal } | null {
  const parts = line.split(":");
  const record = Number(parts[0]);
  const code = parts[3];
  const gribLevel = parts[4];
  if (
    !Number.isInteger(record)
    || record < 1
    || canonicalGribCode(code ?? "") !== selector.code
    || gribLevel !== selector.gribLevel
  ) {
    return null;
  }

  const accumulationMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour acc(?: fcst)?:/i);
  const averageMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour ave(?: fcst)?:/i);
  const maximumMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour max(?: fcst)?:/i);

  if (selector.temporalSemantics === "instantaneous") {
    if (accumulationMatch || averageMatch || maximumMatch) return null;
    return { record, temporal: { type: "instantaneous" } };
  }
  if (selector.temporalSemantics === "accumulation") {
    if (!accumulationMatch?.[1] || !accumulationMatch[2]) return null;
    return {
      record,
      temporal: {
        type: "accumulation",
        startForecastHour: Number(accumulationMatch[1]),
        endForecastHour: Number(accumulationMatch[2]),
      },
    };
  }
  if (selector.temporalSemantics === "average") {
    if (!averageMatch?.[1] || !averageMatch[2]) return null;
    return {
      record,
      temporal: {
        type: "average",
        startForecastHour: Number(averageMatch[1]),
        endForecastHour: Number(averageMatch[2]),
      },
    };
  }
  if (!maximumMatch?.[1] || !maximumMatch[2]) return null;
  return {
    record,
    temporal: {
      type: "maximum",
      startForecastHour: Number(maximumMatch[1]),
      endForecastHour: Number(maximumMatch[2]),
    },
  };
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

function parseSingleStats(stdout: string): GridStatistics {
  const parsed = stdout
    .split(/\r?\n/)
    .map(parseWgrib2StatsLine)
    .filter((value): value is GridStatistics => value !== null);
  if (parsed.length === 0) throw new Error(`wgrib2 returned no usable area statistics. Output: ${stdout.slice(0, 500)}`);
  if (parsed.length > 1) throw new Error(`wgrib2 returned ${parsed.length} statistic records where exactly one was expected`);
  const stats = parsed[0]!;
  if (stats.definedGridPoints <= 0) throw new Error("Requested bbox contains no defined GFS grid points");
  return stats;
}

function fieldNumber(line: string, field: string): number | null {
  const match = line.match(new RegExp(`(?:^|:)${field}=([-+\\d.eE]+)(?=:|$)`));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function defaultNativeExecutable(): string | undefined {
  if (process.env.WGRIB2_PATH) return process.env.WGRIB2_PATH;
  return process.env.WFG_DECODER === "wgrib2" ? "wgrib2" : undefined;
}

function toLongitude360(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}
