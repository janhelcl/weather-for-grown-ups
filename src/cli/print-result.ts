/** Human-readable CLI tables; JSON remains the machine contract. */
export function printAtmosphericResult(result: unknown, json: boolean): void {
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!isRecord(result)) { console.dir(result, { depth: null }); return; }
  if (isUnifiedEnvelope(result)) { printUnifiedEnvelope(result); return; }
  if (isAlignmentEnvelope(result)) { printAlignmentEnvelope(result); return; }
  if (isSpecializedEnvelope(result)) { printSpecializedEnvelope(result); return; }
  printRecordTables(result);
}

/** One row per source, then one table per quantity with a column per source label. */
function printAlignmentEnvelope(envelope: AlignmentEnvelope): void {
  console.log("Alignment:");
  const alignment = isRecord(envelope.alignment) ? envelope.alignment : {};
  console.table([{ initialization: alignment.initialization, sharedInitialization: alignment.sharedInitialization, validTimes: alignment.validTimes, sources: envelope.sources.length, quantities: envelope.quantities.length }]);
  console.log("Sources:");
  console.table(envelope.sources.map((source) => {
    const record = isRecord(source) ? source : {};
    return record.status === "ok"
      ? { label: record.label, dataset: record.dataset, kind: record.kind, run: record.run, members: record.memberCount, gridPoint: summarizeValue(record.gridPoint), steps: Array.isArray(record.steps) ? record.steps.length : undefined, source: summarizeValue(record.source) }
      : { label: record.label, dataset: record.dataset, status: record.status, failure: isRecord(record.failure) ? `${record.failure.code}: ${record.failure.message}` : undefined };
  }));
  const labels = envelope.sources.map((source) => String(isRecord(source) ? source.label : "?"));
  for (const quantity of envelope.quantities) {
    if (!isRecord(quantity)) continue;
    const selection = isRecord(quantity.selection) ? quantity.selection : {};
    const output = isRecord(quantity.output) ? quantity.output : {};
    const title = selection.kind === "pressure"
      ? `${selection.variable}@${selection.pressureLevelHpa}hPa`
      : `${selection.field}`;
    console.log(`${title} → ${output.field} [${output.unit}]${output.deltaKind === "circular_degrees" ? " (circular)" : ""}:`);
    const series = Array.isArray(quantity.series) ? quantity.series : [];
    console.table(series.map((step) => {
      const record = isRecord(step) ? step : {};
      const values = Array.isArray(record.values) ? record.values : [];
      const row: Record<string, unknown> = { validTime: record.validTime };
      labels.forEach((label, index) => { row[label] = summarizeCell(values[index]); });
      if (record.comparable === false) row.comparable = `false (${record.reason})`;
      return row;
    }));
  }
}

function summarizeCell(cell: unknown): unknown {
  if (!isRecord(cell)) return cell;
  switch (cell.kind) {
    case "value": return cell.value;
    case "distribution": return `mean ${round(cell.mean)} ±${round(cell.populationStdDev)} [${round(cell.min)}, ${round(cell.max)}] n=${cell.memberCount}`;
    case "circular_direction": return `dir ${round(cell.meanDirectionDeg)}° R=${round(cell.resultantLength)} n=${cell.memberCount}`;
    case "unavailable": return `— (${cell.reason})`;
    default: return summarizeValue(cell);
  }
}

function round(value: unknown): unknown { return typeof value === "number" ? Math.round(value * 100) / 100 : value; }

function printUnifiedEnvelope(envelope: UnifiedEnvelope): void {
  console.log("Query:");
  console.table([{ dataset: envelope.dataset, internal: envelope.internalDatasetId, role: envelope.role, kind: envelope.kind, geometry: envelope.geometryType, time: envelope.timeType }]);
  printEnvelopeBody(envelope.result);
}

function printSpecializedEnvelope(envelope: SpecializedEnvelope): void {
  console.log("Operation:");
  console.table([{ operation: envelope.operation, datasets: summarizeValue(envelope.datasets) }]);
  printEnvelopeBody(envelope.result);
}

function printEnvelopeBody(result: unknown): void {
  if (!isRecord(result)) { console.dir(result, { depth: null }); return; }
  printRecordTables(result);
}

function printRecordTables(result: Record<string, unknown>): void {
  const header = headerRow(result);
  if (Object.keys(header).length > 0) { console.log("Result:"); console.table([header]); }
  const source = result.source;
  if (isRecord(source) && !Array.isArray(source)) { console.log("Source:"); console.table([flattenShallow(source)]); }
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
    const rest = omit(result, ["source", "levels", "fields", "pressureLevels", "analogs", "points", "series", "samples", "statistics", ...HEADER_KEYS]);
    if (Object.keys(rest).length > 0) console.dir(rest, { depth: 4 });
  }
}

const HEADER_KEYS = ["model", "dataset", "run", "runTime", "validTime", "analysisTime", "forecastHour", "leadHours", "forecastRun", "targetTime", "comparison", "caveat", "indexPath", "candidateCount"] as const;
function headerRow(result: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of HEADER_KEYS) if (result[key] !== undefined) row[key] = summarizeValue(result[key]);
  const point = result.gridPoint ?? result.requestedPoint;
  if (isRecord(point) && typeof point.latitude === "number" && typeof point.longitude === "number") row.gridPoint = `${point.latitude}, ${point.longitude}`;
  return row;
}
function printNamedTable(title: string, value: unknown): void { const rows = tableRows(value); if (rows === undefined) return; console.log(`${title}:`); console.table(rows); }
function tableRows(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => isRecord(item) && !Array.isArray(item))) return undefined;
  return value.map((item) => flattenShallow(item));
}
function firstLevelChanges(pressureLevels: unknown): unknown { if (!Array.isArray(pressureLevels) || pressureLevels.length === 0) return undefined; const first = pressureLevels[0]; return isRecord(first) ? first.changes : undefined; }
function flattenShallow(record: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, summarizeValue(value)])); }
function summarizeValue(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.every((item) => typeof item === "number" || typeof item === "string") ? value.join(", ") : `[${value.length}]`;
  if (isRecord(value)) {
    if (typeof value.latitude === "number" && typeof value.longitude === "number") return `${value.latitude}, ${value.longitude}`;
    if (typeof value.provider === "string" && typeof value.access === "string") return `${value.provider} via ${value.access}`;
    if (typeof value.mean === "number") return value.mean;
    if (typeof value.field === "string" && typeof value.delta === "number") return `${value.field}=${value.delta}`;
    return Object.keys(value).join(",");
  }
  return String(value);
}
function hasPrintedBody(result: Record<string, unknown>): boolean { return [result.levels, result.fields, result.pressureLevels, result.analogs, result.points, result.series, result.samples, result.statistics].some((value) => Array.isArray(value) && value.length > 0); }
function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> { const skip = new Set(keys); return Object.fromEntries(Object.entries(record).filter(([key]) => !skip.has(key))); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
interface UnifiedEnvelope extends Record<string, unknown> { dataset: unknown; internalDatasetId: unknown; role: unknown; kind: unknown; geometryType: unknown; timeType: unknown; result: unknown; }
interface SpecializedEnvelope extends Record<string, unknown> { operation: unknown; datasets: unknown; result: unknown; }
interface AlignmentEnvelope extends Record<string, unknown> { operation: "align_atmosphere"; alignment: unknown; sources: unknown[]; quantities: unknown[]; }
function isAlignmentEnvelope(value: Record<string, unknown>): value is AlignmentEnvelope { return value.operation === "align_atmosphere" && Array.isArray(value.sources) && Array.isArray(value.quantities); }
function isUnifiedEnvelope(value: Record<string, unknown>): value is UnifiedEnvelope { return "dataset" in value && "internalDatasetId" in value && "geometryType" in value && "timeType" in value && "result" in value; }
function isSpecializedEnvelope(value: Record<string, unknown>): value is SpecializedEnvelope { return "operation" in value && "datasets" in value && "result" in value; }
