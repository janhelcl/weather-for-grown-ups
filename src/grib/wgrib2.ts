import { execa } from "execa";
import { GEFS_PGRB2A_FIELD_CATALOG } from "../catalog/gefs-fields.js";
import { findNamedNonIsobaricLevel } from "../catalog/non-isobaric-fields.js";
import { ALL_SUPPORTED_GFS_CODES } from "../catalog/variables.js";
import type { DecodedValue, GribDecoderName } from "../core/types.js";
import {
  canonicalGribCode,
  decodePointMessages,
  messagesAtForecastHour,
  readGribMessages,
} from "./gribberish-runtime.js";

const GEFS_RAW_FIELDS = Object.values(GEFS_PGRB2A_FIELD_CATALOG).filter((definition) => definition.kind === "raw");
const ALL_SUPPORTED_CODES = [...new Set([
  ...ALL_SUPPORTED_GFS_CODES,
  ...GEFS_RAW_FIELDS.map((definition) => definition.gfsCode),
  "BREF",
  "RAIN_CON",
  "SNOW_CON",
  "VIS",
  "CEILING",
  "HBAS_SC",
  "HTOP_SC",
  "HTOP_DC",
  "CAPE_ML",
  "CIN_ML",
  "UH_MAX",
  "GP",
  "VMAX_10M",
  "U_RAF",
  "V_RAF",
  "UGUST",
  "VGUST",
  "efg10",
  "nfg10",
])];
const SUPPORTED_CODE_SET = new Set<string>(ALL_SUPPORTED_CODES.map((code) => code.toUpperCase()));
const CODE_PATTERN = new RegExp(`:(${ALL_SUPPORTED_CODES.join("|")}):`, "i");
const GEFS_NAMED_VERTICALS = new Set(
  GEFS_RAW_FIELDS.map((definition) => definition.level.gribLevel),
);

/**
 * Point decoder kept under its original public class name for API compatibility.
 * The default implementation is bundled through npm and needs no system executable.
 * Set WGRIB2_PATH (or WFG_DECODER=wgrib2) to opt into the legacy native wgrib2 path.
 */
export type Wgrib2NameConvention = "DWD" | "ECMWF" | "NCEP";

export class Wgrib2Decoder {
  readonly engine: GribDecoderName;

  constructor(
    private readonly executable = defaultNativeExecutable(),
    private readonly names?: Wgrib2NameConvention,
  ) {
    this.engine = executable === undefined ? "gribberish" : "wgrib2";
  }

  async extractPoint(
    path: string,
    longitude: number,
    latitude: number,
    forecastHour?: number,
  ): Promise<DecodedValue[]> {
    if (this.executable === undefined) {
      const messages = await readGribMessages(path);
      const selected = forecastHour === undefined
        ? messages
        : messagesAtForecastHour(messages, forecastHour);
      const decoded = decodePointMessages(selected, longitude, latitude);
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
        ...wgrib2NamesArgs(this.names),
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
      .filter((line) => forecastHour === undefined || wgrib2LineForecastHour(line) === forecastHour)
      .map((line) => parseWgrib2PointLine(line, this.names))
      .filter((value): value is DecodedValue => value !== null);

    if (decoded.length === 0) {
      throw new Error(`wgrib2 returned no supported point values. Output: ${stdout.slice(0, 500)}`);
    }

    return decoded;
  }
}

export function wgrib2LineForecastHour(line: string): number | undefined {
  if (/:anl:/i.test(line)) return 0;

  const interval = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour (?:acc|ave|max)(?: fcst)?:/i);
  if (interval?.[2] !== undefined) return Number(interval[2]);

  const hourMinute = line.match(/:(\d+(?:\.\d+)?) hour(?: (\d+(?:\.\d+)?) (?:min|minute)s?)? fcst:/i);
  if (hourMinute?.[1] !== undefined) {
    return Number(hourMinute[1]) + Number(hourMinute[2] ?? 0) / 60;
  }

  const minute = line.match(/:(\d+(?:\.\d+)?) (?:min|minute)s? fcst:/i);
  if (minute?.[1] !== undefined) return Number(minute[1]) / 60;
  return undefined;
}

export function parseWgrib2PointLine(
  line: string,
  names?: Wgrib2NameConvention,
): DecodedValue | null {
  const parts = line.split(":");
  const inventoryCode = parts[3] ?? "";
  const gribLevel = parts[4] ?? "";
  const codeMatch = line.match(CODE_PATTERN);
  const conventionCode = names === "DWD"
    ? canonicalDwdIconCode(inventoryCode)
      ?? dwdMeanLayerCodeFromInventory(inventoryCode, gribLevel)
    : undefined;
  const aromeReflectivityMatch = line.match(
    /:var discipline=0 center=85 local_table=0 parmcat=16 parm=193:/i,
  );
  const dwdConvectivePrecipitationMatch = line.match(
    /:var discipline=0 center=78 local_table=\d+ parmcat=1 parm=(76|55):/i,
  );
  const dwdCloudHeightMatch = line.match(
    /:var discipline=0 center=78 local_table=\d+ parmcat=6 parm=(192|193|196):/i,
  );
  const dwdUpdraftHelicityMatch = names === "DWD"
    ? line.match(/:var discipline=0[^:]*\bparmcat=7\s+parm=15:/i)
    : null;
  const dwdCloudHeightCode = names === "DWD"
    ? conventionCode ?? dwdCloudHeightCodeFromParameter(dwdCloudHeightMatch?.[1])
    : undefined;
  const dwdUpdraftHelicityCode = names === "DWD"
    && (conventionCode === "UH_MAX" || dwdUpdraftHelicityMatch)
      ? "UH_MAX"
      : undefined;
  const pressureMatch = gribLevel.match(/^(\d+(?:\.\d+)?) mb$/);
  const surfaceMatch = gribLevel === "surface";
  const heightMatch = gribLevel.match(/^(\d+(?:\.\d+)?) m above ground$/);
  const gfsNamedLevel = findNamedNonIsobaricLevel(gribLevel);
  const dwdCeilingLevel = names === "DWD"
    && canonicalDwdIconCode(inventoryCode) === "CEILING";
  const dwdMslHeightLevel = dwdCloudHeightCode === "HBAS_SC"
    || dwdCloudHeightCode === "HTOP_SC"
    || dwdCloudHeightCode === "HTOP_DC";
  const dwdMeanLayerLevel = conventionCode === "CAPE_ML" || conventionCode === "CIN_ML";
  const dwdUpdraftHelicityLevel = dwdUpdraftHelicityCode === "UH_MAX";
  const modelNamedVertical = /^(?:atmos col|surface\s*-\s*top of atmosphere)$/i.test(gribLevel)
    ? "entire atmosphere"
    : dwdCeilingLevel
      ? "cloud ceiling"
      : dwdMslHeightLevel
        ? "mean sea level"
        : dwdMeanLayerLevel
          ? "mean layer"
          : dwdUpdraftHelicityLevel
            ? "2-8 km above mean sea level"
            : gfsNamedLevel?.gribLevel
        ?? (GEFS_NAMED_VERTICALS.has(gribLevel) ? gribLevel : undefined);
  const pointMatch = line.match(/lon=([-+\d.eE]+),lat=([-+\d.eE]+)/);
  const valueMatch = line.match(/val=([-+\d.eE]+)/);

  if (
    (!codeMatch
      && conventionCode === undefined
      && !aromeReflectivityMatch
      && !dwdConvectivePrecipitationMatch
      && !dwdCloudHeightMatch
      && !dwdUpdraftHelicityMatch)
    || (!pressureMatch && !surfaceMatch && !heightMatch && !modelNamedVertical)
    || !pointMatch
    || !valueMatch
  ) {
    return null;
  }

  const dwdRawParameter = dwdConvectivePrecipitationMatch?.[1];
  const rawCode = conventionCode
    ?? dwdUpdraftHelicityCode
    ?? codeMatch?.[1]
    ?? dwdCloudHeightCode
    ?? (dwdRawParameter === "76"
      ? "RAIN_CON"
      : dwdRawParameter === "55"
        ? "SNOW_CON"
        : "AROME_RFLCTVT_MAX");
  const code = aromeReflectivityMatch
    ? "AROME_RFLCTVT_MAX"
    : canonicalWgrib2Code(rawCode, names);
  if (
    !aromeReflectivityMatch
    && !SUPPORTED_CODE_SET.has(code.toUpperCase())
  ) return null;

  const accumulationMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour acc(?: fcst)?:/i);
  const averageMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour ave(?: fcst)?:/i);
  const maximumMatch = line.match(/:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour max(?: fcst)?:/i);
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
    ...(maximumMatch?.[1] !== undefined && maximumMatch[2] !== undefined
      ? {
          maximum: {
            startForecastHour: Number(maximumMatch[1]),
            endForecastHour: Number(maximumMatch[2]),
          },
        }
      : {}),
    value: normalizeWgrib2Value(
      names === "DWD" ? inventoryCode : rawCode,
      Number(valueMatch[1]),
      names,
    ),
    gridPoint: {
      longitude: toSignedLongitude(Number(pointMatch[1])),
      latitude: Number(pointMatch[2]),
    },
  };
}

export function canonicalWgrib2Code(
  code: string,
  names?: Wgrib2NameConvention,
): string {
  if (names === "DWD") {
    return canonicalDwdIconCode(code) ?? canonicalGribCode(code);
  }
  return canonicalGribCode(code);
}

export function canonicalDwdIconCode(code: string): string | undefined {
  switch (code.toUpperCase()) {
    case "T": return "TMP";
    case "RELHUM": return "RH";
    case "U": return "UGRD";
    case "V": return "VGRD";
    case "FI": return "HGT";
    case "OMEGA": return "VVEL";
    case "T_2M": return "TMP";
    case "U_10M": return "UGRD";
    case "V_10M": return "VGRD";
    case "VMAX_10M": return "GUST";
    case "PMSL": return "PRMSL";
    case "TOT_PREC": return "APCP";
    case "PRR_CON": return "RAIN_CON";
    case "PRS_CON": return "SNOW_CON";
    case "VIS": return "VIS";
    case "CEIL": return "CEILING";
    case "CEILING": return "CEILING";
    case "HBAS_SC": return "HBAS_SC";
    case "HTOP_SC": return "HTOP_SC";
    case "HTOP_DC": return "HTOP_DC";
    case "CAPE_ML": return "CAPE_ML";
    case "CIN_ML": return "CIN_ML";
    case "UH_MAX": return "UH_MAX";
    case "UPHL": return "UH_MAX";
    case "DBZ": return "BREF";
    default: return undefined;
  }
}

function dwdMeanLayerCodeFromInventory(
  code: string,
  gribLevel: string,
): "CAPE_ML" | "CIN_ML" | undefined {
  if (!/^local level type 192(?:\s|$)/i.test(gribLevel)) return undefined;
  switch (code.toUpperCase()) {
    case "CAPE":
    case "CAPE_CON":
      return "CAPE_ML";
    case "CIN": return "CIN_ML";
    default: return undefined;
  }
}

function dwdCloudHeightCodeFromParameter(
  parameter: string | undefined,
): "HBAS_SC" | "HTOP_SC" | "HTOP_DC" | undefined {
  switch (parameter) {
    case "192": return "HBAS_SC";
    case "193": return "HTOP_SC";
    case "196": return "HTOP_DC";
    default: return undefined;
  }
}

function normalizeWgrib2Value(
  rawCode: string,
  value: number,
  names?: Wgrib2NameConvention,
): number {
  if (
    rawCode.toUpperCase() === "GP"
    || (names === "DWD" && rawCode.toUpperCase() === "FI")
  ) {
    return value / 9.80665;
  }
  return value;
}

export function wgrib2NamesArgs(
  names: Wgrib2NameConvention | undefined,
): string[] {
  return names === undefined ? [] : ["-names", names];
}

function defaultNativeExecutable(): string | undefined {
  if (process.env.WGRIB2_PATH) return process.env.WGRIB2_PATH;
  return process.env.WFG_DECODER === "wgrib2" ? "wgrib2" : undefined;
}

function toSignedLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
}
