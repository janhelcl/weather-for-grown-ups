import {
  UnifiedAtmosphereAlignmentService,
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
} from "../src/core/unified-atmosphere-api.js";
import { LatestRunResolver } from "../src/core/latest-run.js";
import {
  estimateGfsPointMessagesPerStep,
  selectAutomaticGfsDiagnosticSource,
  selectAutomaticGfsPointSource,
  type GfsPointSelection,
} from "../src/core/gfs-point-source.js";
import { decodeWorkerCount, shutdownGribDecodePool } from "../src/grib/grib-decode-pool.js";
import type { DiagnoseAtmosphereInput, QueryAtmosphereInput } from "../src/schema/unified-api.js";
import type { AlignAtmosphereInput } from "../src/schema/unified-alignment.js";
import type { VariableId } from "../src/schema/query.js";

const HOUR_MS = 3_600_000;
const PRAGUE = { latitude: 50.08, longitude: 14.43 };
const BRNO = { latitude: 49.20, longitude: 16.61 };
const LIBEREC = { latitude: 50.77, longitude: 15.06 };
const NARROW: GfsPointSelection = {
  variables: ["temperature"] satisfies VariableId[],
  pressureLevelsHpa: [850],
};
const PROFILE: GfsPointSelection = {
  variables: ["temperature", "relative_humidity", "u_wind", "v_wind"] satisfies VariableId[],
  pressureLevelsHpa: [850, 700, 500],
};

type Case = {
  id: string;
  tool: "query" | "diagnose" | "align";
  complexity: string;
  run: () => Promise<unknown>;
};

const queryService = new UnifiedAtmosphereQueryService();
const diagnoseService = new UnifiedAtmosphereDiagnosticService();
const alignService = new UnifiedAtmosphereAlignmentService();

const gfsRun = await new LatestRunResolver().resolveLatestRun();
const at = (forecastHour: number): string =>
  new Date(gfsRun.getTime() + forecastHour * HOUR_MS).toISOString();

console.error(`GFS run ${gfsRun.toISOString()}  decode workers ${decodeWorkerCount()}`);

const gfsForecast = { run: gfsRun.toISOString() };
const gfsPoint = { type: "point" as const, ...PRAGUE };

function gfsQuery(partial: Omit<QueryAtmosphereInput, "dataset">): Promise<unknown> {
  return queryService.query({ dataset: "gfs", forecast: gfsForecast, ...partial });
}

function selection(sel: GfsPointSelection): NonNullable<QueryAtmosphereInput["selection"]> {
  return {
    ...(sel.variables === undefined ? {} : { variables: [...sel.variables] }),
    ...(sel.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: [...sel.pressureLevelsHpa] }),
    ...(sel.fields === undefined ? {} : { fields: [...sel.fields] }),
  };
}

const cases: Case[] = [
  {
    id: "query point × 1 step × 1 message",
    tool: "query",
    complexity: `auto ${selectAutomaticGfsPointSource(NARROW)} ${estimateGfsPointMessagesPerStep(NARROW)} msg`,
    run: () => gfsQuery({
      geometry: gfsPoint,
      time: { at: at(6) },
      selection: selection(NARROW),
    }),
  },
  {
    id: "query point × 1 step × 12 messages",
    tool: "query",
    complexity: `auto ${selectAutomaticGfsPointSource(PROFILE)} ${estimateGfsPointMessagesPerStep(PROFILE)} msg`,
    run: () => gfsQuery({
      geometry: gfsPoint,
      time: { at: at(6) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query 3 points × 1 step × 12 messages",
    tool: "query",
    complexity: "same artifact, unpack once per message",
    run: () => gfsQuery({
      geometry: { type: "points", points: [PRAGUE, BRNO, LIBEREC] },
      time: { at: at(6) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query transect 5 samples × 1 step",
    tool: "query",
    complexity: "5 nearest-neighbour samples / message",
    run: () => gfsQuery({
      geometry: {
        type: "transect",
        start: { latitude: 50.1, longitude: 14.3 },
        end: { latitude: 51.0, longitude: 16.0 },
        samples: 5,
      },
      time: { at: at(6) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query transect 12 samples × 1 step",
    tool: "query",
    complexity: "12 nearest-neighbour samples / message",
    run: () => gfsQuery({
      geometry: {
        type: "transect",
        start: { latitude: 50.1, longitude: 14.3 },
        end: { latitude: 51.0, longitude: 16.0 },
        samples: 12,
      },
      time: { at: at(6) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query point × 3 hourly steps",
    tool: "query",
    complexity: "3 native GFS hours, 12 msg/step",
    run: () => gfsQuery({
      geometry: gfsPoint,
      time: { from: at(6), to: at(8) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query point × 6 hourly steps",
    tool: "query",
    complexity: "6 native GFS hours, 12 msg/step",
    run: () => gfsQuery({
      geometry: gfsPoint,
      time: { from: at(6), to: at(11) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "query 3 points × 3 hourly steps",
    tool: "query",
    complexity: "9 point-steps, unpack-once per step",
    run: () => gfsQuery({
      geometry: { type: "points", points: [PRAGUE, BRNO, LIBEREC] },
      time: { from: at(6), to: at(8) },
      selection: selection(PROFILE),
    }),
  },
  {
    id: "diagnose layer 850-500",
    tool: "diagnose",
    complexity: diagnosticComplexity({
      kind: "layer",
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["temperature_lapse_rate", "wind_shear"],
    }),
    run: () => diagnoseService.diagnose({
      dataset: "gfs",
      forecast: gfsForecast,
      geometry: gfsPoint,
      time: { at: at(6) },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate", "wind_shear"],
      },
    }),
  },
  {
    id: "diagnose profile 5 levels",
    tool: "diagnose",
    complexity: diagnosticComplexity({
      kind: "profile",
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    }),
    run: () => diagnoseService.diagnose({
      dataset: "gfs",
      forecast: gfsForecast,
      geometry: gfsPoint,
      time: { at: at(6) },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
    }),
  },
  {
    id: "diagnose profile × 3 hourly steps",
    tool: "diagnose",
    complexity: "3 native hours, 10 msg/step S3",
    run: () => diagnoseService.diagnose({
      dataset: "gfs",
      forecast: gfsForecast,
      geometry: gfsPoint,
      time: { from: at(6), to: at(8) },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
    }),
  },
  {
    id: "query area Prague 1° × 1 field",
    tool: "query",
    complexity: "NOMADS geographic subset",
    run: () => gfsQuery({
      geometry: {
        type: "area",
        westLongitude: 13.9,
        eastLongitude: 14.9,
        southLatitude: 49.6,
        northLatitude: 50.6,
      },
      time: { at: at(6) },
      selection: { fields: ["temperature_2m"] },
      aggregate: { percentiles: [10, 50, 90] },
    }),
  },
  {
    id: "diagnose parcel surface_2m 5 levels",
    tool: "diagnose",
    complexity: diagnosticComplexity({
      kind: "parcel",
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
      parcel: "surface_2m",
    }),
    run: () => diagnoseService.diagnose({
      dataset: "gfs",
      forecast: gfsForecast,
      geometry: gfsPoint,
      time: { at: at(6) },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
        parcel: "surface_2m",
      },
    }),
  },
  {
    id: "query GEFS c00,p01 point × 1 step",
    tool: "query",
    complexity: "2 members, AWS GEFS",
    run: () => queryService.query({
      dataset: "gefs",
      geometry: gfsPoint,
      time: { at: at(6) },
      selection: selection(PROFILE),
      ensemble: { members: ["c00", "p01"], quantiles: [0.1, 0.5, 0.9] },
    }),
  },
  {
    id: "align GFS + IFS point × 1 step",
    tool: "align",
    complexity: "two providers, independent runs",
    run: () => alignService.align({
      sources: [
        { dataset: "gfs", forecast: gfsForecast },
        { dataset: "ifs" },
      ],
      geometry: gfsPoint,
      time: { at: at(6) },
      selection: selection(PROFILE),
    } satisfies AlignAtmosphereInput),
  },
];

type Row = {
  id: string;
  tool: string;
  complexity: string;
  pass: "first" | "repeat";
  ms: number;
  ok: boolean;
  detail: string;
};

const rows: Row[] = [];

for (const item of cases) {
  for (const pass of ["first", "repeat"] as const) {
    const started = performance.now();
    try {
      const result = await item.run();
      const ms = Math.round(performance.now() - started);
      const detail = summarize(result);
      rows.push({ id: item.id, tool: item.tool, complexity: item.complexity, pass, ms, ok: true, detail });
      console.error(`${pass.padEnd(6)} ${String(ms).padStart(6)} ms  ${item.id}  ${detail}`);
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const detail = error instanceof Error ? error.message : String(error);
      rows.push({ id: item.id, tool: item.tool, complexity: item.complexity, pass, ms, ok: false, detail });
      console.error(`${pass.padEnd(6)} ${String(ms).padStart(6)} ms  FAIL ${item.id}  ${detail}`);
    }
  }
}

shutdownGribDecodePool();

console.log(JSON.stringify({
  run: gfsRun.toISOString(),
  decodeWorkers: decodeWorkerCount(),
  rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
  rows,
}, null, 2));

function diagnosticComplexity(diagnostic: DiagnoseAtmosphereInput["diagnostic"]): string {
  const source = selectAutomaticGfsDiagnosticSource(diagnostic);
  return `auto ${source}`;
}

function summarize(value: unknown): string {
  const found = { access: new Set<string>(), decoder: new Set<string>(), hits: 0, misses: 0 };
  walk(value, found);
  const cache = found.hits + found.misses === 0
    ? "cache=?"
    : `cache ${found.hits} hit / ${found.misses} miss`;
  const access = found.access.size === 0 ? "" : ` ${[...found.access].join(",")}`;
  const decoder = found.decoder.size === 0 ? "" : ` ${[...found.decoder].join(",")}`;
  return `${cache}${access}${decoder}`;
}

function walk(
  value: unknown,
  acc: { access: Set<string>; decoder: Set<string>; hits: number; misses: number },
): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, acc);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.cacheHit === "boolean" && (typeof record.access === "string" || typeof record.decoder === "string")) {
    if (record.cacheHit) acc.hits += 1;
    else acc.misses += 1;
    if (typeof record.access === "string") acc.access.add(record.access);
    if (typeof record.decoder === "string") acc.decoder.add(record.decoder);
  }
  for (const nested of Object.values(record)) walk(nested, acc);
}
