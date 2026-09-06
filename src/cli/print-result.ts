/**
 * Human-readable CLI tables for atmospheric results. JSON remains the
 * machine contract; this is a catalog-style view of the same payload.
 */
export function printAtmosphericResult(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!isRecord(result)) {
    console.dir(result, { depth: null });
    return;
  }

  if (isUnifiedEnvelope(result)) {
    printUnifiedEnvelope(result);
    return;
  }
  printRecordTables(result);
}

function printUnifiedEnvelope(envelope: UnifiedEnvelope): void {
  console.log("Query:");
  console.table([{
    dataset: envelope.dataset,
    internal: envelope.internalDatasetId,
    role: envelope.role,
    kind: envelope.kind,
    geometry: envelope.geometryType,
    time: envelope.timeType,
  }]);
  if (!isRecord(envelope.result)) {
    console.dir(envelope.result, { depth: null });
    return;
  }
  printRecordTables(envelope.result);
}

function printRecordTables(result: Record<string, unknown>): void {
  const header = headerRow(result);
  if (Object.keys(header).length > 0) {
    console.log("Result:");
    console.table([header]);
  }

  const source = result.source;
  if (isRecord(source) && !Array.isArray(source)) {
    console.log("Source:");
    console.table([flattenShallow(source)]);
  }

  printNamedTable("Levels", result.levels);
  printNamedTable("Fields", result.fields);
  printNamedTable("Pressure levels", result.pressureLevels);
  printNamedTable("Analogs", result.analogs);
  printNamedTable("Points", result.points);
  printNamedTable("Series", result.series);
  printNamedTable("Samples", result.samples);
  printNamedTable("Statistics", result.statistics);
  printNamedTable("Changes", firstLevelChanges(result.pressureLevels));

  if (!hasPrintedBody(result)) {
    const rest = omit(result, [
      "source", "levels", "fields", "pressureLevels", "analogs",
      "points", "series", "samples", "statistics",
      ...HEADER_KEYS,
    ]);
    if (Object.keys(rest).length > 0) console.dir(rest, { depth: 4 });
  }
}

const HEADER_KEYS = [
  "model", "dataset", "run", "runTime", "validTime", "analysisTime",
  "forecastHour", "leadHours", "forecastRun", "targetTime",
  "comparison", "caveat", "indexPath", "candidateCount",
] as const;

function headerRow(result: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of HEADER_KEYS) {
    const value = result[key];
    if (value === undefined) continue;
    row[key] = summarizeValue(value);
  }
  const point = result.gridPoint ?? result.requestedPoint;
  if (isRecord(point) && typeof point.latitude === "number" && typeof point.longitude === "number") {
    row.gridPoint = `${point.latitude}, ${point.longitude}`;
  }
  return row;
}

function printNamedTable(title: string, value: unknown): void {
  const rows = tableRows(value);
  if (rows === undefined) return;
  console.log(`${title}:`);
  console.table(rows);
}

function tableRows(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => isRecord(item) && !Array.isArray(item))) return undefined;
  return value.map((item) => flattenShallow(item));
}

function firstLevelChanges(pressureLevels: unknown): unknown {
  if (!Array.isArray(pressureLevels) || pressureLevels.length === 0) return undefined;
  const first = pressureLevels[0];
  if (!isRecord(first)) return undefined;
  return first.changes;
}

function flattenShallow(record: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    row[key] = summarizeValue(value);
  }
  return row;
}

function summarizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number" || typeof item === "string")) {
      return value.join(", ");
    }
    return `[${value.length}]`;
  }
  if (isRecord(value)) {
    if (typeof value.latitude === "number" && typeof value.longitude === "number") {
      return `${value.latitude}, ${value.longitude}`;
    }
    if (typeof value.mean === "number") return value.mean;
    if (typeof value.field === "string" && typeof value.delta === "number") {
      return `${value.field}=${value.delta}`;
    }
    return Object.keys(value).join(",");
  }
  return String(value);
}

function hasPrintedBody(result: Record<string, unknown>): boolean {
  return [
    result.levels, result.fields, result.pressureLevels, result.analogs,
    result.points, result.series, result.samples, result.statistics,
  ].some((value) => Array.isArray(value) && value.length > 0);
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const skip = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !skip.has(key)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface UnifiedEnvelope extends Record<string, unknown> {
  dataset: unknown;
  internalDatasetId: unknown;
  role: unknown;
  kind: unknown;
  geometryType: unknown;
  timeType: unknown;
  result: unknown;
}

function isUnifiedEnvelope(value: Record<string, unknown>): value is UnifiedEnvelope {
  return "dataset" in value
    && "internalDatasetId" in value
    && "geometryType" in value
    && "timeType" in value
    && "result" in value;
}
