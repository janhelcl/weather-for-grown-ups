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
  const codes = new Set(variableCodes);
  const levels = new Set(pressureLevelsHpa);
  const selectedStarts = new Set(
    records
      .filter(
        (record) =>
          codes.has(record.variable) &&
          record.pressureHpa !== undefined &&
          levels.has(record.pressureHpa),
      )
      .map((record) => record.startByte),
  );

  if (selectedStarts.size === 0) {
    throw new Error("No matching pressure-level fields found in GFS index");
  }

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
