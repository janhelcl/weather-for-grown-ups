export type DwdLocalGribCode =
  | "RAIN_CON"
  | "SNOW_CON"
  | "HBAS_SC"
  | "HTOP_SC"
  | "HTOP_DC"
  | "CAPE_ML"
  | "CIN_ML";

export interface Grib2MessageSlice {
  start: number;
  end: number;
  discipline: number;
  center: number | undefined;
  subcenter: number | undefined;
  masterTable: number | undefined;
  localTable: number | undefined;
  centerOffset: number | undefined;
  subcenterOffset: number | undefined;
  masterTableOffset: number | undefined;
  localTableOffset: number | undefined;
  category: number | undefined;
  parameter: number | undefined;
  categoryOffset: number | undefined;
  parameterOffset: number | undefined;
  firstFixedSurfaceType: number | undefined;
  firstFixedSurfaceTypeOffset: number | undefined;
}

export interface DwdLocalParameterDefinition {
  alias: DwdLocalGribCode;
  category: number;
  localParameter: number;
  surrogate: readonly [category: number, parameter: number];
  genericProcessing: boolean;
  firstFixedSurfaceType?: number;
}

export interface DwdLocalRewriteSummary extends DwdLocalParameterDefinition {
  count: number;
  identification: {
    center: number;
    subcenter: number;
    masterTable: number;
    localTable: number;
  };
}

export interface PreparedDwdLocalParameters {
  bytes: Uint8Array;
  rewrites: readonly DwdLocalRewriteSummary[];
}

const DWD_CENTER = 78;
const METEOROLOGICAL_DISCIPLINE = 0;
const DWD_LOCAL_PARAMETERS = [
  {
    alias: "RAIN_CON",
    category: 1,
    localParameter: 76,
    surrogate: [1, 10],
    genericProcessing: true,
  },
  {
    alias: "SNOW_CON",
    category: 1,
    localParameter: 55,
    surrogate: [1, 53],
    genericProcessing: true,
  },
  {
    alias: "HBAS_SC",
    category: 6,
    localParameter: 192,
    surrogate: [3, 5],
    genericProcessing: false,
  },
  {
    alias: "HTOP_SC",
    category: 6,
    localParameter: 193,
    surrogate: [3, 5],
    genericProcessing: false,
  },
  {
    alias: "HTOP_DC",
    category: 6,
    localParameter: 196,
    surrogate: [3, 5],
    genericProcessing: false,
  },
  {
    alias: "CAPE_ML",
    category: 7,
    localParameter: 6,
    surrogate: [7, 6],
    genericProcessing: true,
    firstFixedSurfaceType: 192,
  },
  {
    alias: "CIN_ML",
    category: 7,
    localParameter: 7,
    surrogate: [7, 7],
    genericProcessing: true,
    firstFixedSurfaceType: 192,
  },
] as const satisfies readonly DwdLocalParameterDefinition[];

export function knownDwdLocalParameter(
  discipline: number,
  center: number | undefined,
  category: number | undefined,
  parameter: number | undefined,
  firstFixedSurfaceType?: number,
): DwdLocalParameterDefinition | undefined {
  if (
    discipline !== METEOROLOGICAL_DISCIPLINE
    || center !== DWD_CENTER
  ) return undefined;
  return DWD_LOCAL_PARAMETERS.find((entry) =>
    entry.category === category
    && entry.localParameter === parameter
    && (!("firstFixedSurfaceType" in entry)
      || entry.firstFixedSurfaceType === firstFixedSurfaceType));
}

/**
 * Preserve DWD-specific GRIB semantics across generic processing.
 *
 * Local convective-precipitation parameter numbers are temporarily rewritten
 * to WMO-defined surrogates. Mean-layer CAPE/CIN already use standard
 * parameter numbers, but their DWD fixed-surface type 192 is still recorded so
 * tools such as CDO cannot silently collapse them into another CAPE/CIN parcel
 * definition. Values, grid definitions, ensemble metadata, reference/valid
 * times, and statistical intervals stay untouched.
 */
export function prepareDwdLocalParametersForGenericProcessing(
  bytes: Uint8Array,
): PreparedDwdLocalParameters {
  const chunks = scanGrib2Messages(bytes);
  let rewritten: Uint8Array | undefined;
  const summaries = new Map<DwdLocalGribCode, DwdLocalRewriteSummary>();

  for (const chunk of chunks) {
    const local = knownDwdLocalParameter(
      chunk.discipline,
      chunk.center,
      chunk.category,
      chunk.parameter,
      chunk.firstFixedSurfaceType,
    );
    if (local === undefined || !local.genericProcessing) continue;
    if (
      chunk.categoryOffset === undefined
      || chunk.parameterOffset === undefined
      || chunk.center === undefined
      || chunk.subcenter === undefined
      || chunk.masterTable === undefined
      || chunk.localTable === undefined
    ) {
      throw new Error(`DWD local parameter ${local.alias} is missing required GRIB2 metadata`);
    }

    rewritten ??= Uint8Array.from(bytes);
    rewritten[chunk.categoryOffset] = local.surrogate[0];
    rewritten[chunk.parameterOffset] = local.surrogate[1];

    const existing = summaries.get(local.alias);
    const identification = {
      center: chunk.center,
      subcenter: chunk.subcenter,
      masterTable: chunk.masterTable,
      localTable: chunk.localTable,
    };
    if (existing === undefined) {
      summaries.set(local.alias, {
        ...local,
        count: 1,
        identification,
      });
    } else {
      if (!sameIdentification(existing.identification, identification)) {
        throw new Error(
          `DWD local parameter ${local.alias} used inconsistent GRIB2 identification metadata`,
        );
      }
      existing.count += 1;
    }
  }

  return {
    bytes: rewritten ?? bytes,
    rewrites: [...summaries.values()],
  };
}

/**
 * Restore DWD parameter and fixed-surface identities after generic processing.
 *
 * Restoration is deliberately strict: the number of matching messages must
 * equal the number recorded before processing. This prevents accidentally
 * relabelling an unrelated standard field if a future request mixes an
 * ambiguous surrogate or CAPE/CIN parcel definition into the same file.
 */
export function restoreDwdLocalParametersAfterGenericProcessing(
  bytes: Uint8Array,
  rewrites: readonly DwdLocalRewriteSummary[],
): Uint8Array {
  if (rewrites.length === 0) return bytes;
  const restored = Uint8Array.from(bytes);
  const chunks = scanGrib2Messages(restored);

  for (const rewrite of rewrites) {
    const candidates = chunks.filter((chunk) =>
      chunk.discipline === METEOROLOGICAL_DISCIPLINE
      && chunk.category === rewrite.surrogate[0]
      && chunk.parameter === rewrite.surrogate[1]);
    if (candidates.length !== rewrite.count) {
      throw new Error(
        `Generic GRIB processing changed ${rewrite.alias} message cardinality: expected ${rewrite.count}, found ${candidates.length}`,
      );
    }

    for (const chunk of candidates) {
      if (
        chunk.categoryOffset === undefined
        || chunk.parameterOffset === undefined
        || chunk.centerOffset === undefined
        || chunk.subcenterOffset === undefined
        || chunk.masterTableOffset === undefined
        || chunk.localTableOffset === undefined
        || (rewrite.firstFixedSurfaceType !== undefined
          && chunk.firstFixedSurfaceTypeOffset === undefined)
      ) {
        throw new Error(`Cannot restore DWD local parameter ${rewrite.alias}: incomplete GRIB2 metadata`);
      }
      restored[chunk.categoryOffset] = rewrite.category;
      restored[chunk.parameterOffset] = rewrite.localParameter;
      writeUint16Be(restored, chunk.centerOffset, rewrite.identification.center);
      writeUint16Be(restored, chunk.subcenterOffset, rewrite.identification.subcenter);
      restored[chunk.masterTableOffset] = rewrite.identification.masterTable;
      restored[chunk.localTableOffset] = rewrite.identification.localTable;
      if (
        rewrite.firstFixedSurfaceType !== undefined
        && chunk.firstFixedSurfaceTypeOffset !== undefined
      ) {
        restored[chunk.firstFixedSurfaceTypeOffset] = rewrite.firstFixedSurfaceType;
      }
    }
  }

  return restored;
}

export function scanGrib2Messages(bytes: Uint8Array): Grib2MessageSlice[] {
  const chunks: Grib2MessageSlice[] = [];
  let cursor = 0;

  while (cursor + 16 <= bytes.length) {
    if (!hasGribMagic(bytes, cursor) || bytes[cursor + 7] !== 2) {
      cursor += 1;
      continue;
    }

    const length = readUint64Be(bytes, cursor + 8);
    if (length < 20 || cursor + length > bytes.length) {
      cursor += 1;
      continue;
    }

    const end = cursor + length;
    const discipline = bytes[cursor + 6]!;
    let center: number | undefined;
    let subcenter: number | undefined;
    let masterTable: number | undefined;
    let localTable: number | undefined;
    let centerOffset: number | undefined;
    let subcenterOffset: number | undefined;
    let masterTableOffset: number | undefined;
    let localTableOffset: number | undefined;
    let category: number | undefined;
    let parameter: number | undefined;
    let categoryOffset: number | undefined;
    let parameterOffset: number | undefined;
    let firstFixedSurfaceType: number | undefined;
    let firstFixedSurfaceTypeOffset: number | undefined;
    let sectionCursor = cursor + 16;

    while (sectionCursor + 5 <= end - 4) {
      const sectionLength = readUint32Be(bytes, sectionCursor);
      if (sectionLength < 5 || sectionCursor + sectionLength > end) break;
      const sectionNumber = bytes[sectionCursor + 4];

      if (sectionNumber === 1 && sectionLength >= 11) {
        centerOffset = sectionCursor + 5;
        subcenterOffset = sectionCursor + 7;
        masterTableOffset = sectionCursor + 9;
        localTableOffset = sectionCursor + 10;
        center = readUint16Be(bytes, centerOffset);
        subcenter = readUint16Be(bytes, subcenterOffset);
        masterTable = bytes[masterTableOffset];
        localTable = bytes[localTableOffset];
      } else if (sectionNumber === 4 && sectionLength >= 11) {
        categoryOffset = sectionCursor + 9;
        parameterOffset = sectionCursor + 10;
        category = bytes[categoryOffset];
        parameter = bytes[parameterOffset];
        if (sectionLength >= 23) {
          firstFixedSurfaceTypeOffset = sectionCursor + 22;
          firstFixedSurfaceType = bytes[firstFixedSurfaceTypeOffset];
        }
      }
      sectionCursor += sectionLength;
    }

    chunks.push({
      start: cursor,
      end,
      discipline,
      center,
      subcenter,
      masterTable,
      localTable,
      centerOffset,
      subcenterOffset,
      masterTableOffset,
      localTableOffset,
      category,
      parameter,
      categoryOffset,
      parameterOffset,
      firstFixedSurfaceType,
      firstFixedSurfaceTypeOffset,
    });
    cursor = end;
  }

  return chunks;
}

function sameIdentification(
  left: DwdLocalRewriteSummary["identification"],
  right: DwdLocalRewriteSummary["identification"],
): boolean {
  return left.center === right.center
    && left.subcenter === right.subcenter
    && left.masterTable === right.masterTable
    && left.localTable === right.localTable;
}

function hasGribMagic(bytes: Uint8Array, offset: number): boolean {
  return bytes[offset] === 0x47
    && bytes[offset + 1] === 0x52
    && bytes[offset + 2] === 0x49
    && bytes[offset + 3] === 0x42;
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function writeUint16Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
}

function readUint64Be(bytes: Uint8Array, offset: number): number {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(value);
}
