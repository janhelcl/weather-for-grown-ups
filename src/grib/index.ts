import type { FieldTemporalSemantics } from "../catalog/non-isobaric-fields.js";

export interface GribIndexRecord {
  message: string;
  startByte: number;
  variable: string;
  level: string;
  pressureHpa: number | undefined;
  raw: string;
}

export interface ByteRange {
  start: number;
  end?: number;
}

export interface NonIsobaricGribSelector {
  id: string;
  gfsCode: string;
  level: { gribLevel: string };
  temporalSemantics: FieldTemporalSemantics;
}

export function parseGribIndex(text: string): GribIndexRecord[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split(":");
      if (parts.length < 5) throw new Error(`Malformed GRIB index line: ${line}`);

      const message = parts[0];
      const startByte = Number(parts[1]);
      const variable = parts[3];
      const level = parts[4];
      if (!message || !Number.isInteger(startByte) || startByte < 0 || !variable || !level) {
        throw new Error(`Malformed GRIB index line: ${line}`);
      }

      const pressureMatch = level.match(/^(\d+(?:\.\d+)?) mb$/);
      return {
        message,
        startByte,
        variable,
        level,
        pressureHpa: pressureMatch?.[1] === undefined ? undefined : Number(pressureMatch[1]),
        raw: line,
      };
    });
}

export function selectPressureByteRanges(
  records: GribIndexRecord[],
  variableCodes: Iterable<string>,
  pressureLevelsHpa: Iterable<number>,
): ByteRange[] {
  const codes = [...new Set(variableCodes)];
  const levels = [...new Set(pressureLevelsHpa)];
  const availablePairs = new Set(
    records
      .filter((record) => record.pressureHpa !== undefined)
      .map((record) => `${record.variable}@${record.pressureHpa}`),
  );
  const missing = codes.flatMap((code) =>
    levels
      .filter((level) => !availablePairs.has(`${code}@${level}`))
      .map((level) => `${code}@${level}mb`),
  );
  if (missing.length > 0) {
    throw new Error(`GFS index is missing requested fields: ${missing.join(", ")}`);
  }

  const codeSet = new Set(codes);
  const levelSet = new Set(levels);
  const selectedStarts = new Set(
    records
      .filter(
        (record) =>
          codeSet.has(record.variable) &&
          record.pressureHpa !== undefined &&
          levelSet.has(record.pressureHpa),
      )
      .map((record) => record.startByte),
  );

  return rangesForStarts(records, selectedStarts);
}

export function selectPressureByteRangesAtForecastHour(
  records: GribIndexRecord[],
  variableCodes: Iterable<string>,
  pressureLevelsHpa: Iterable<number>,
  forecastHour: number,
): ByteRange[] {
  const codes = [...new Set(variableCodes)];
  const levels = [...new Set(pressureLevelsHpa)];
  const atHour = records.filter((record) => forecastEndHour(record) === forecastHour);
  const availablePairs = new Set(
    atHour
      .filter((record) => record.pressureHpa !== undefined)
      .map((record) => `${record.variable}@${record.pressureHpa}`),
  );
  const missing = codes.flatMap((code) =>
    levels
      .filter((level) => !availablePairs.has(`${code}@${level}`))
      .map((level) => `${code}@${level}mb@f${forecastHour}`),
  );
  if (missing.length > 0) {
    throw new Error(`GFS index is missing requested fields: ${missing.join(", ")}`);
  }
  const codeSet = new Set(codes);
  const levelSet = new Set(levels);
  const selectedStarts = new Set(
    atHour
      .filter((record) =>
        codeSet.has(record.variable)
        && record.pressureHpa !== undefined
        && levelSet.has(record.pressureHpa))
      .map((record) => record.startByte),
  );
  return rangesForStarts(records, selectedStarts);
}

export function selectNonIsobaricByteRanges(
  records: GribIndexRecord[],
  fields: Iterable<NonIsobaricGribSelector>,
): ByteRange[] {
  const selectedStarts = new Set<number>();
  const missing: string[] = [];

  for (const field of fields) {
    const match = records.find((record) =>
      record.variable === field.gfsCode &&
      record.level === field.level.gribLevel &&
      matchesTemporalSemantics(record, field.temporalSemantics),
    );
    if (!match) {
      missing.push(`${field.id} (${field.gfsCode}@${field.level.gribLevel}, ${field.temporalSemantics})`);
      continue;
    }
    selectedStarts.add(match.startByte);
  }

  if (missing.length > 0) {
    throw new Error(`GFS index is missing requested fields: ${missing.join(", ")}`);
  }
  return rangesForStarts(records, selectedStarts);
}

export function selectNonIsobaricByteRangesAtForecastHour(
  records: GribIndexRecord[],
  fields: Iterable<NonIsobaricGribSelector>,
  forecastHour: number,
): ByteRange[] {
  const selectedStarts = new Set<number>();
  const missing: string[] = [];

  for (const field of fields) {
    const match = records.find((record) =>
      record.variable === field.gfsCode
      && record.level === field.level.gribLevel
      && matchesTemporalSemantics(record, field.temporalSemantics)
      && forecastEndHour(record) === forecastHour,
    );
    if (!match) {
      missing.push(
        `${field.id} (${field.gfsCode}@${field.level.gribLevel}, ${field.temporalSemantics}, f${forecastHour})`,
      );
      continue;
    }
    selectedStarts.add(match.startByte);
  }

  if (missing.length > 0) {
    throw new Error(`GFS index is missing requested fields: ${missing.join(", ")}`);
  }
  return rangesForStarts(records, selectedStarts);
}

/**
 * Select every isobaric message for the given variable codes. Used by
 * gfs-analysis GRIB backends that emulate NCSS's full vertical-column CSV
 * and let the historical parsers filter to the requested levels.
 */
export function selectAllPressureByteRanges(
  records: GribIndexRecord[],
  variableCodes: Iterable<string>,
): ByteRange[] {
  const codeSet = new Set(variableCodes);
  const selectedStarts = new Set(
    records
      .filter((record) => codeSet.has(record.variable) && record.pressureHpa !== undefined)
      .map((record) => record.startByte),
  );
  if (selectedStarts.size === 0) {
    throw new Error(
      `GFS index has no isobaric messages for: ${[...codeSet].sort().join(", ") || "<none>"}`,
    );
  }
  return rangesForStarts(records, selectedStarts);
}

/**
 * Select messages by exact GRIB variable code and level string (e.g.
 * `TMP` + `2 m above ground`). When `gribLevel` is omitted, every level of
 * that variable that is not an isobaric `mb` surface is taken — matching
 * NCSS multi-height CSV rows for a shared variable name.
 */
export function selectNamedLevelByteRanges(
  records: GribIndexRecord[],
  selectors: Iterable<{ gfsCode: string; gribLevel?: string }>,
): ByteRange[] {
  const selectedStarts = new Set<number>();
  const missing: string[] = [];
  for (const selector of selectors) {
    const matches = records.filter((record) => {
      if (record.variable !== selector.gfsCode) return false;
      if (selector.gribLevel !== undefined) return record.level === selector.gribLevel;
      return record.pressureHpa === undefined;
    });
    if (matches.length === 0) {
      missing.push(
        selector.gribLevel === undefined
          ? `${selector.gfsCode}@*`
          : `${selector.gfsCode}@${selector.gribLevel}`,
      );
      continue;
    }
    for (const match of matches) selectedStarts.add(match.startByte);
  }
  if (missing.length > 0) {
    throw new Error(`GFS index is missing requested fields: ${missing.join(", ")}`);
  }
  return rangesForStarts(records, selectedStarts);
}

export function mergeByteRanges(...groups: ByteRange[][]): ByteRange[] {
  const byStart = new Map<number, ByteRange>();
  for (const range of groups.flat()) byStart.set(range.start, range);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

function matchesTemporalSemantics(
  record: GribIndexRecord,
  semantics: FieldTemporalSemantics,
): boolean {
  const descriptor = forecastDescriptor(record);
  if (semantics === "accumulation") return /\bacc\b/i.test(descriptor);
  if (semantics === "average") return /\bave\b/i.test(descriptor);
  if (semantics === "maximum") return /\bmax\b/i.test(descriptor);
  return !/\b(?:acc|ave|max)\b/i.test(descriptor);
}

function forecastDescriptor(record: GribIndexRecord): string {
  return record.raw.split(":")[5] ?? "";
}

function forecastEndHour(record: GribIndexRecord): number | undefined {
  const descriptor = forecastDescriptor(record);
  const range = descriptor.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) hour\b/i);
  if (range?.[2] !== undefined) return Number(range[2]);
  const single = descriptor.match(/(?:^|\b)(\d+(?:\.\d+)?) hour fcst\b/i);
  return single?.[1] === undefined ? undefined : Number(single[1]);
}

function rangesForStarts(records: GribIndexRecord[], selectedStarts: Set<number>): ByteRange[] {
  const allStarts = [...new Set(records.map((record) => record.startByte))].sort((a, b) => a - b);
  const indexByStart = new Map(allStarts.map((start, index) => [start, index]));

  return [...selectedStarts]
    .sort((a, b) => a - b)
    .map((start) => {
      const index = indexByStart.get(start);
      if (index === undefined) throw new Error(`Internal index error for byte ${start}`);
      const next = allStarts[index + 1];
      return next === undefined ? { start } : { start, end: next - 1 };
    });
}
