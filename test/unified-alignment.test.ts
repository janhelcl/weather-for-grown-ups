import { describe, expect, it, vi } from "vitest";
import { expandSelectionQuantities, readPointEvidence } from "../src/core/atmospheric-evidence.js";
import {
  DEFAULT_ALIGNMENT_SOURCE_CONCURRENCY,
  UnifiedAtmosphereAlignmentService,
  sourceLabels,
} from "../src/core/unified-atmosphere-alignment.js";
import { DataUnavailableError, InvalidRequestError, WfgError } from "../src/failure.js";
import { redactEmbeddedInternalFailures } from "../src/mcp-unified-tool.js";
import { alignAtmosphereSchema, type AlignAtmosphereInput } from "../src/schema/unified-alignment.js";
import type { UnifiedAtmosphereResult } from "../src/schema/unified-api.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const at = "2026-09-10T12:00:00Z";
const T12 = "2026-09-10T12:00:00.000Z";
const T15 = "2026-09-10T15:00:00.000Z";
const T18 = "2026-09-10T18:00:00.000Z";

function envelope(
  dataset: string,
  result: unknown,
  overrides: Partial<UnifiedAtmosphereResult> = {},
): UnifiedAtmosphereResult {
  return {
    dataset,
    internalDatasetId: dataset === "gfs" ? "gfs_0p25" : dataset === "ifs" ? "ifs_0p25" : dataset === "gefs" ? "gefs_0p50" : dataset === "ifs-ens" ? "ifs_ens_0p25" : "aigefs_0p25",
    role: "forecast",
    kind: dataset === "gefs" || dataset === "ifs-ens" || dataset === "aigefs" ? "ensemble" : "deterministic",
    geometryType: "point",
    timeType: "instant",
    result,
    ...overrides,
  } as UnifiedAtmosphereResult;
}

function deterministicStep(validTime: string, forecastHour: number, t850: number, dir850: number, t2m: number, precip?: { value: number; start: string }) {
  return {
    validTime,
    forecastHour,
    levels: [{ pressureHpa: 850, temperatureC: t850, windSpeedMs: 4.2, windDirectionDeg: dir850 }],
    fields: [
      { id: "temperature_2m", level: "2 m above ground", temporal: { type: "instantaneous" }, values: { temperatureC: t2m } },
      ...(precip === undefined
        ? []
        : [{ id: "total_precipitation", level: "surface", temporal: { type: "accumulation", startTime: precip.start, endTime: validTime }, values: { totalPrecipitationMm: precip.value } }]),
    ],
  };
}

function deterministicResult(run: string, steps: ReturnType<typeof deterministicStep>[]) {
  const base = { model: "GFS", run, gridPoint: { latitude: 50, longitude: 14.5 }, source: { provider: "NOAA" } };
  return steps.length === 1 ? { ...base, ...steps[0] } : { ...base, series: steps };
}

const ifsEnsResult = {
  model: "IFS ENS",
  run: T12.replace("T12", "T00"),
  gridPoint: { latitude: 50, longitude: 14.5 },
  members: Array.from({ length: 50 }, (_, index) => `p${index + 1}`),
  validTime: T12,
  forecastHour: 12,
  pressureSummaries: [{
    variable: "temperature",
    pressureLevelHpa: 850,
    outputs: [{ aggregation: "numeric_distribution", field: "temperatureC", distribution: { memberCount: 50, mean: 5.75, populationStdDev: 0.39, min: 5.09, max: 6.7, quantiles: [{ quantile: 0.5, value: 5.7 }] } }],
  }, {
    variable: "wind",
    pressureLevelHpa: 850,
    outputs: [
      { aggregation: "numeric_distribution", field: "windSpeedMs", distribution: { memberCount: 50, mean: 3.5, populationStdDev: 0.5, min: 2.7, max: 5.1, quantiles: [] } },
      { aggregation: "circular_direction", field: "windDirectionDeg", memberCount: 50, meanDirectionDeg: 283.5, resultantLength: 0.99 },
    ],
  }],
  fieldSummaries: [{
    field: "temperature_2m",
    level: "2 m above ground",
    temporal: { type: "instantaneous" },
    outputs: [{ aggregation: "numeric_distribution", field: "temperatureC", distribution: { memberCount: 50, mean: 18.56, populationStdDev: 0.69, min: 17.1, max: 20.5, quantiles: [] } }],
  }],
  source: { provider: "ECMWF" },
};

const aigefsResult = {
  model: "AIGEFS",
  run: "2026-09-10T00:00:00.000Z",
  validTime: T12,
  selection: { members: ["c00", "p01", "p02"] },
  pressureSummaries: [
    { pressureLevelHpa: 850, field: "temperatureC", aggregation: "numeric_distribution", distribution: { memberCount: 3, mean: 6, populationStdDev: 0.2, min: 5.8, max: 6.2, quantiles: [] } },
  ],
  source: { provider: "NOAA" },
};

const gefsResult = {
  model: "GEFS",
  run: "2026-09-10T00:00:00.000Z",
  validTime: T12,
  source: { provider: "NOAA", memberCount: 31 },
  pressureSummaries: [
    { variable: "temperature", pressureLevelHpa: 850, outputField: "temperatureC", unit: "degC", distribution: { memberCount: 31, mean: 5.9, populationStdDev: 0.4, min: 5, max: 6.9, quantiles: [] } },
  ],
};

describe("atmospheric evidence reader", () => {
  const quantities = expandSelectionQuantities({ variables: ["temperature", "wind"], pressureLevelsHpa: [850], fields: ["temperature_2m"] });

  it("expands the canonical selection into one quantity per output with delta semantics", () => {
    expect(quantities.map((quantity) => quantity.key)).toEqual([
      "pressure:temperature@850:temperatureC",
      "pressure:wind@850:windSpeedMs",
      "pressure:wind@850:windDirectionDeg",
      "field:temperature_2m:temperatureC",
    ]);
    expect(quantities[2]?.output).toEqual({ field: "windDirectionDeg", unit: "degree", deltaKind: "circular_degrees" });
    expect(quantities[0]?.output).toMatchObject({ unit: "degC", deltaKind: "linear" });
  });

  it("reads deterministic instants, ranges and accumulation windows", () => {
    const instant = readPointEvidence(envelope("gfs", deterministicResult("2026-09-10T00:00:00.000Z", [deterministicStep(T12, 12, 6.2, 284, 19.2)])), quantities);
    expect(instant.run).toBe("2026-09-10T00:00:00.000Z");
    expect(instant.gridPoint).toEqual({ latitude: 50, longitude: 14.5 });
    expect(instant.memberCount).toBeUndefined();
    expect(instant.steps).toHaveLength(1);
    expect(instant.steps[0]?.cells.get("pressure:temperature@850:temperatureC")).toEqual({ kind: "value", value: 6.2 });
    expect(instant.steps[0]?.cells.get("pressure:wind@850:windDirectionDeg")).toEqual({ kind: "value", value: 284 });
    expect(instant.steps[0]?.cells.get("field:temperature_2m:temperatureC")).toEqual({ kind: "value", value: 19.2 });

    const precipitation = expandSelectionQuantities({ fields: ["total_precipitation"] });
    const range = readPointEvidence(
      envelope("gfs", deterministicResult("2026-09-10T00:00:00.000Z", [
        deterministicStep(T12, 12, 6, 280, 19, { value: 0.4, start: "2026-09-10T06:00:00.000Z" }),
        deterministicStep(T15, 15, 6, 280, 19, { value: 0.1, start: T12 }),
      ]), { timeType: "range" }),
      precipitation,
    );
    expect(range.steps.map((step) => step.validTime)).toEqual([T12, T15]);
    expect(range.steps[1]?.cells.get("field:total_precipitation:totalPrecipitationMm")).toEqual({
      kind: "value",
      value: 0.1,
      window: { type: "accumulation", startTime: T12, endTime: T15 },
    });
  });

  it("normalizes the three native ensemble summary packagings into member-first cells", () => {
    const ifsEns = readPointEvidence(envelope("ifs-ens", ifsEnsResult), quantities);
    expect(ifsEns.memberCount).toBe(50);
    expect(ifsEns.steps[0]?.cells.get("pressure:temperature@850:temperatureC")).toMatchObject({ kind: "distribution", memberCount: 50, mean: 5.75, quantiles: [{ quantile: 0.5, value: 5.7 }] });
    expect(ifsEns.steps[0]?.cells.get("pressure:wind@850:windDirectionDeg")).toEqual({ kind: "circular_direction", memberCount: 50, meanDirectionDeg: 283.5, resultantLength: 0.99 });
    expect(ifsEns.steps[0]?.cells.get("field:temperature_2m:temperatureC")).toMatchObject({ kind: "distribution", mean: 18.56 });

    const aigefs = readPointEvidence(envelope("aigefs", aigefsResult), quantities);
    expect(aigefs.memberCount).toBe(3);
    expect(aigefs.steps[0]?.cells.get("pressure:temperature@850:temperatureC")).toMatchObject({ kind: "distribution", memberCount: 3, mean: 6 });
    expect(aigefs.steps[0]?.cells.get("pressure:wind@850:windSpeedMs")).toEqual({ kind: "unavailable", reason: "output_missing" });

    const gefs = readPointEvidence(envelope("gefs", gefsResult), quantities);
    expect(gefs.memberCount).toBe(31);
    expect(gefs.steps[0]?.cells.get("pressure:temperature@850:temperatureC")).toMatchObject({ kind: "distribution", memberCount: 31, mean: 5.9 });
  });

  it("uses analysisTime as the valid time for analysis datasets", () => {
    const analysis = readPointEvidence(
      envelope("gfs-analysis", { analysisTime: "2017-05-09T12:00:00.000Z", levels: [{ pressureHpa: 850, temperatureC: 10 }], source: {} }, { internalDatasetId: "gfs_grid4_analysis_0p5", role: "analysis" }),
      expandSelectionQuantities({ variables: ["temperature"], pressureLevelsHpa: [850] }),
    );
    expect(analysis.steps[0]?.validTime).toBe("2017-05-09T12:00:00.000Z");
    expect(analysis.run).toBeUndefined();
  });
});

describe("align_atmosphere schema", () => {
  it("accepts dataset-shaped sources and applies alignment defaults", () => {
    const parsed = alignAtmosphereSchema.parse({
      sources: [{ dataset: "gfs" }, { dataset: "gfs", forecast: { run: "2026-09-09T18:00:00Z" } }, { dataset: "ifs-ens", ensemble: { quantiles: [0.1, 0.9] } }],
      geometry: point,
      time: { at },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      alignment: {},
    });
    expect(parsed.alignment).toEqual({ initialization: "independent", validTimes: "intersection" });
    expect(parsed.sources).toHaveLength(3);
  });

  it("rejects requests that do not form a well-posed alignment", () => {
    const base = { geometry: point, time: { at }, selection: { variables: ["temperature"], pressureLevelsHpa: [850] } };
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }] })).toThrow();
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }, { dataset: "gfs" }] })).toThrow(/same dataset, forecast, ensemble and source/);
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs", label: "x" }, { dataset: "ifs", label: "x" }] })).toThrow(/already used/);
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }, { dataset: "ifs", ensemble: { quantiles: [0.5] } }] })).toThrow();
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }, { dataset: "gefs", ensemble: { includeMembers: true } }] })).toThrow(/includeMembers/);
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }, { dataset: "ifs" }], geometry: { type: "points", points: [point, point] } })).toThrow();
    expect(() => alignAtmosphereSchema.parse({ ...base, sources: [{ dataset: "gfs" }, { dataset: "ifs" }], selection: { fields: ["nope"] } })).toThrow(/Unknown canonical field/);
  });
});

describe("UnifiedAtmosphereAlignmentService", () => {
  const selection = { variables: ["temperature", "wind"], pressureLevelsHpa: [850], fields: ["temperature_2m"] };

  function fakeQueryService(responses: Record<string, (query: any) => Promise<UnifiedAtmosphereResult> | UnifiedAtmosphereResult>) {
    return {
      query: vi.fn(async (query: any) => {
        const key = `${query.dataset}@${query.forecast?.run ?? "latest"}`;
        const handler = responses[key] ?? responses[query.dataset];
        if (handler === undefined) throw new Error(`no fixture for ${key}`);
        return handler(query);
      }),
    };
  }

  it("fans one point × time × selection question out to every source and joins by valid time", async () => {
    const queryService = fakeQueryService({
      "gfs@latest": () => envelope("gfs", deterministicResult("2026-09-10T00:00:00.000Z", [deterministicStep(T12, 12, 6.2, 284, 19.2)])),
      "gfs@2026-09-09T18:00:00Z": () => envelope("gfs", deterministicResult("2026-09-09T18:00:00.000Z", [deterministicStep(T12, 18, 5.4, 291, 18.3)])),
      "ifs-ens": () => envelope("ifs-ens", ifsEnsResult),
    });
    const service = new UnifiedAtmosphereAlignmentService({ queryService });

    const result = await service.align({
      sources: [{ dataset: "gfs" }, { dataset: "gfs", forecast: { run: "2026-09-09T18:00:00Z" } }, { dataset: "ifs-ens", ensemble: { quantiles: [0.5] } }],
      geometry: point,
      time: { at },
      selection,
    });

    expect(queryService.query).toHaveBeenCalledTimes(3);
    for (const call of queryService.query.mock.calls) {
      expect(call[0]).toMatchObject({ geometry: point, time: { at }, selection });
    }
    expect(queryService.query.mock.calls[2]?.[0]).toMatchObject({ dataset: "ifs-ens", ensemble: { quantiles: [0.5] } });
    expect(queryService.query.mock.calls[0]?.[0]).not.toHaveProperty("ensemble");

    expect(result.operation).toBe("align_atmosphere");
    expect(result.alignment).toMatchObject({
      initialization: "independent",
      sharedInitialization: false,
      validTimes: "intersection",
      runs: [
        { label: "gfs@latest", run: "2026-09-10T00:00:00.000Z" },
        { label: "gfs@2026-09-09T18:00:00Z", run: "2026-09-09T18:00:00.000Z" },
        { label: "ifs-ens", run: "2026-09-10T00:00:00.000Z" },
      ],
    });
    expect(result.sources.map((source) => source.label)).toEqual(["gfs@latest", "gfs@2026-09-09T18:00:00Z", "ifs-ens"]);
    expect(result.sources[2]).toMatchObject({ status: "ok", kind: "ensemble", memberCount: 50, modelClass: "physics", provider: "ecmwf" });

    expect(result.quantities.map((quantity) => quantity.output.field)).toEqual(["temperatureC", "windSpeedMs", "windDirectionDeg", "temperatureC"]);
    const t850 = result.quantities[0]!;
    expect(t850.selection).toEqual({ kind: "pressure", variable: "temperature", pressureLevelHpa: 850 });
    expect(t850.series).toHaveLength(1);
    expect(t850.series[0]).toMatchObject({ validTime: T12, comparable: true });
    expect(t850.series[0]?.values).toEqual([
      { kind: "value", value: 6.2 },
      { kind: "value", value: 5.4 },
      expect.objectContaining({ kind: "distribution", memberCount: 50, mean: 5.75 }),
    ]);
    const direction = result.quantities[2]!;
    expect(direction.output.deltaKind).toBe("circular_degrees");
    expect(direction.series[0]?.values[2]).toEqual({ kind: "circular_direction", memberCount: 50, meanDirectionDeg: 283.5, resultantLength: 0.99 });
  });

  it("reports failed sources inline as structured failures without substituting evidence", async () => {
    const queryService = fakeQueryService({
      gfs: () => envelope("gfs", deterministicResult("2026-09-10T00:00:00.000Z", [deterministicStep(T12, 12, 6.2, 284, 19.2)])),
      gefs: () => { throw new InvalidRequestError("GEFS does not expose wind as a canonical variable"); },
      ifs: () => { throw new DataUnavailableError("ECMWF cycle not yet published"); },
    });
    const service = new UnifiedAtmosphereAlignmentService({ queryService });
    const result = await service.align({ sources: [{ dataset: "gfs" }, { dataset: "gefs", ensemble: { quantiles: [0.5] } }, { dataset: "ifs" }], geometry: point, time: { at }, selection });

    expect(result.sources[1]).toMatchObject({ status: "failed", failure: { code: "INVALID_REQUEST", retryable: false } });
    expect(result.sources[2]).toMatchObject({ status: "failed", failure: { code: "DATA_UNAVAILABLE" } });
    expect(result.quantities[0]?.series[0]?.values).toEqual([
      { kind: "value", value: 6.2 },
      { kind: "unavailable", reason: "source_failed" },
      { kind: "unavailable", reason: "source_failed" },
    ]);
  });

  it("fails the whole request only when every source failed, keeping the first failure's code", async () => {
    const queryService = fakeQueryService({
      gfs: () => { throw new DataUnavailableError("gfs down"); },
      ifs: () => { throw new InvalidRequestError("ifs bad"); },
    });
    const service = new UnifiedAtmosphereAlignmentService({ queryService });
    const error = await service.align({ sources: [{ dataset: "gfs" }, { dataset: "ifs" }], geometry: point, time: { at }, selection }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WfgError);
    expect((error as WfgError).code).toBe("DATA_UNAVAILABLE");
    expect((error as WfgError).message).toContain("Every alignment source failed");
    expect((error as WfgError).details).toMatchObject({ sources: [{ label: "gfs" }, { label: "ifs" }] });
  });

  it("enforces shared initialization with a repairable failure and reports it when satisfied", async () => {
    const queryService = fakeQueryService({
      gfs: () => envelope("gfs", deterministicResult("2026-09-10T00:00:00.000Z", [deterministicStep(T12, 12, 6.2, 284, 19.2)])),
      ifs: (query) => envelope("ifs", deterministicResult(query.forecast?.run === "2026-09-10T00:00:00Z" ? "2026-09-10T00:00:00.000Z" : "2026-09-10T06:00:00.000Z", [deterministicStep(T12, 6, 5.6, 283, 18.3)])),
    });
    const service = new UnifiedAtmosphereAlignmentService({ queryService });
    const base = { sources: [{ dataset: "gfs" }, { dataset: "ifs" }], geometry: point, time: { at }, selection } satisfies AlignAtmosphereInput;

    const error = await service.align({ ...base, alignment: { initialization: "shared" } }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect((error as InvalidRequestError).message).toContain("gfs=2026-09-10T00:00:00.000Z, ifs=2026-09-10T06:00:00.000Z");
    expect((error as InvalidRequestError).details).toMatchObject({ suggestedRun: "2026-09-10T00:00:00.000Z" });

    const shared = await service.align({
      ...base,
      sources: [{ dataset: "gfs" }, { dataset: "ifs", forecast: { run: "2026-09-10T00:00:00Z" } }],
      alignment: { initialization: "shared" },
    });
    expect(shared.alignment.sharedInitialization).toBe(true);
    expect(shared.alignment.initialization).toBe("shared");
  });

  it("aligns ranges on the intersection or union of native valid times and flags differing windows", async () => {
    const run = "2026-09-10T00:00:00.000Z";
    const queryService = fakeQueryService({
      gfs: () => envelope("gfs", deterministicResult(run, [
        deterministicStep(T12, 12, 6, 280, 19, { value: 0.4, start: "2026-09-10T06:00:00.000Z" }),
        deterministicStep(T15, 15, 6, 280, 19, { value: 0.1, start: T12 }),
        deterministicStep(T18, 18, 6, 280, 19, { value: 0.2, start: T12 }),
      ]), { timeType: "range" }),
      ifs: () => envelope("ifs", deterministicResult(run, [
        deterministicStep(T12, 12, 5, 270, 18, { value: 0.3, start: run }),
        deterministicStep(T18, 18, 5, 270, 18, { value: 0.5, start: run }),
      ]), { timeType: "range" }),
    });
    const service = new UnifiedAtmosphereAlignmentService({ queryService });
    const range = { sources: [{ dataset: "gfs" }, { dataset: "ifs" }], geometry: point, time: { from: at, to: "2026-09-10T18:00:00Z" }, selection: { fields: ["total_precipitation", "temperature_2m"] } } satisfies AlignAtmosphereInput;

    const intersection = await service.align(range);
    expect(intersection.time).toEqual({ from: at, to: "2026-09-10T18:00:00Z" });
    expect(intersection.quantities[0]?.series.map((step) => step.validTime)).toEqual([T12, T18]);
    expect(intersection.quantities[0]?.series[0]).toMatchObject({ comparable: false, reason: "temporal_windows_differ" });
    expect(intersection.quantities[0]?.series[1]).toMatchObject({ comparable: false, reason: "temporal_windows_differ" });
    expect(intersection.quantities[1]?.series.every((step) => step.comparable)).toBe(true);

    const union = await service.align({ ...range, alignment: { validTimes: "union" } });
    expect(union.quantities[1]?.series.map((step) => step.validTime)).toEqual([T12, T15, T18]);
    expect(union.quantities[1]?.series[1]?.values).toEqual([
      { kind: "value", value: 19 },
      { kind: "unavailable", reason: "valid_time_not_sampled" },
    ]);
    expect(union.sources[0]).toMatchObject({ steps: [{ validTime: T12, forecastHour: 12 }, { validTime: T15, forecastHour: 15 }, { validTime: T18, forecastHour: 18 }] });
  });

  it("bounds source fan-out with the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const queryService = {
      query: vi.fn(async (query: any) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return envelope("gfs", deterministicResult(`2026-09-0${query.forecast.run.slice(9, 10)}T00:00:00.000Z`, [deterministicStep(T12, 12, 6, 280, 19)]));
      }),
    };
    const service = new UnifiedAtmosphereAlignmentService({ queryService, sourceConcurrency: 2 });
    await service.align({
      sources: [1, 2, 3, 4, 5].map((day) => ({ dataset: "gfs" as const, forecast: { run: `2026-09-0${day}T00:00:00Z` } })),
      geometry: point,
      time: { at },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(queryService.query).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
    expect(DEFAULT_ALIGNMENT_SOURCE_CONCURRENCY).toBeLessThanOrEqual(8);
  });

  it("derives short unambiguous default labels and honors explicit ones", () => {
    expect(sourceLabels([{ dataset: "gfs" }, { dataset: "ifs" }])).toEqual(["gfs", "ifs"]);
    expect(sourceLabels([{ dataset: "gfs" }, { dataset: "gfs", forecast: { run: "2026-09-09T18:00:00Z" } }]))
      .toEqual(["gfs@latest", "gfs@2026-09-09T18:00:00Z"]);
    expect(sourceLabels([{ dataset: "gfs", label: "control" }, { dataset: "gfs", forecast: { grid: "0p50" } }]))
      .toEqual(["control", "gfs@latest"]);
    expect(sourceLabels([{ dataset: "gfs", forecast: { grid: "0p25" } }, { dataset: "gfs", forecast: { grid: "0p50" } }]))
      .toEqual(["gfs@latest", "gfs@latest#1"]);
    expect(sourceLabels([{ dataset: "ifs", label: "gfs" }, { dataset: "gfs" }])).toEqual(["gfs", "gfs#1"]);
  });
});

describe("MCP boundary for alignment results", () => {
  it("redacts embedded INTERNAL_ERROR text while keeping classified failures verbatim", () => {
    const result = {
      operation: "align_atmosphere",
      sources: [
        { index: 0, label: "gfs", dataset: "gfs", requested: {}, status: "failed", failure: { code: "INTERNAL_ERROR", message: "Decoded GRIB data is missing requested fields", retryable: false } },
        { index: 1, label: "ifs", dataset: "ifs", requested: {}, status: "failed", failure: { code: "DATA_UNAVAILABLE", message: "cycle not published", retryable: true } },
      ],
      quantities: [],
    } as any;
    const redacted = redactEmbeddedInternalFailures(result);
    expect(redacted.sources[0]).toMatchObject({ failure: { code: "INTERNAL_ERROR", message: "Unexpected internal error while handling the request" } });
    expect(redacted.sources[1]).toMatchObject({ failure: { message: "cycle not published" } });
  });
});
