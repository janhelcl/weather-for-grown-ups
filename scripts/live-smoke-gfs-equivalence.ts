import assert from "node:assert/strict";
import {
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
} from "../src/core/unified-atmosphere-api.js";

type Grid = "0p25" | "0p50";
type Source = "s3" | "archive";

const HOUR_MS = 3_600_000;
const POINT = { latitude: 50, longitude: 14 };
const SECOND_POINT = { latitude: 49.5, longitude: 14.5 };
const PRESSURE_LEVELS = [925, 850, 700, 500] as const;
const PROFILE_VARIABLES = [
  "temperature",
  "relative_humidity",
  "wind",
  "geopotential_height",
  "specific_humidity",
  "vertical_velocity",
  "absolute_vorticity",
  "dew_point",
  "potential_temperature",
  "mixing_ratio",
  "virtual_temperature",
  "air_density",
  "wet_bulb_temperature",
  "equivalent_potential_temperature",
] as const;

const queryService = new UnifiedAtmosphereQueryService();
const diagnosticService = new UnifiedAtmosphereDiagnosticService();

const summaries = [];
for (const grid of ["0p25", "0p50"] as const) {
  summaries.push(await verifyGrid(grid));
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), summaries }, null, 2));

async function verifyGrid(grid: Grid) {
  const run = await findOverlapRun(grid);
  const runIso = run.toISOString();
  const f006 = new Date(run.getTime() + 6 * HOUR_MS).toISOString();
  const f012 = new Date(run.getTime() + 12 * HOUR_MS).toISOString();

  const operationalProfile = await pointProfile(grid, "s3", runIso, f006);
  const archivedProfile = await pointProfile(grid, "archive", runIso, f006);
  assert.equal(operationalProfile.run, archivedProfile.run);
  assert.equal(operationalProfile.validTime, archivedProfile.validTime);
  assert.deepEqual(operationalProfile.gridPoint, archivedProfile.gridPoint);
  compareNumericTree(operationalProfile.levels, archivedProfile.levels, `${grid}.profile.levels`, 2e-4);

  const operationalFields = await pointFields(grid, "s3", runIso, f006);
  const archivedFields = await pointFields(grid, "archive", runIso, f006);
  compareFieldResults(operationalFields.fields, archivedFields.fields, `${grid}.fields`);

  const operationalRange = await pointRange(grid, "s3", runIso, f006, f012);
  const archivedRange = await pointRange(grid, "archive", runIso, f006, f012);
  const operationalByHour = new Map(
    operationalRange.series.map((step: any) => [step.forecastHour, step]),
  );
  for (const archivedStep of archivedRange.series) {
    const operationalStep = operationalByHour.get(archivedStep.forecastHour);
    assert(operationalStep, `${grid}: operational range lacks archive-native f${archivedStep.forecastHour}`);
    compareNumericTree(
      operationalStep.levels,
      archivedStep.levels,
      `${grid}.range.f${archivedStep.forecastHour}`,
      2e-4,
    );
  }
  if (grid === "0p25") {
    assert(
      operationalRange.series.length >= archivedRange.series.length,
      "Operational 0.25 should be at least as temporally dense as the historical 0.25 archive",
    );
  } else {
    assert.deepEqual(
      operationalRange.series.map((step: any) => step.forecastHour),
      archivedRange.series.map((step: any) => step.forecastHour),
    );
  }

  const operationalPoints = await pointsInstant(grid, "s3", runIso, f006);
  const archivedPoints = await pointsInstant(grid, "archive", runIso, f006);
  assert.equal(operationalPoints.points.length, archivedPoints.points.length);
  for (let index = 0; index < operationalPoints.points.length; index += 1) {
    const left = operationalPoints.points[index];
    const right = archivedPoints.points[index];
    assert.deepEqual(left.requestedPoint, right.requestedPoint);
    assert.deepEqual(left.gridPoint, right.gridPoint);
    compareNumericTree(left.levels, right.levels, `${grid}.points[${index}]`, 2e-4);
  }

  const operationalLayer = await layerDiagnostic(grid, "s3", runIso, f006);
  const archivedLayer = await layerDiagnostic(grid, "archive", runIso, f006);
  compareNumericTree(
    { layer: operationalLayer.layer, diagnostics: operationalLayer.diagnostics },
    { layer: archivedLayer.layer, diagnostics: archivedLayer.diagnostics },
    `${grid}.layerDiagnostic`,
    3e-4,
  );

  const operationalProfileDiagnostic = await profileDiagnostic(grid, "s3", runIso, f006);
  const archivedProfileDiagnostic = await profileDiagnostic(grid, "archive", runIso, f006);
  compareNumericTree(
    operationalProfileDiagnostic.diagnostics,
    archivedProfileDiagnostic.diagnostics,
    `${grid}.profileDiagnostic`,
    3e-4,
  );

  const operationalParcel = await parcelDiagnostic(grid, "s3", runIso, f006);
  const archivedParcel = await parcelDiagnostic(grid, "archive", runIso, f006);
  compareNumericTree(
    stripParcelPath(operationalParcel.parcel),
    stripParcelPath(archivedParcel.parcel),
    `${grid}.parcel`,
    1e-3,
  );

  const operationalArea = await areaSummary(grid, "s3", runIso, f006);
  const archivedArea = await areaSummary(grid, "archive", runIso, f006);
  assert.equal(
    operationalArea.statistics.definedGridPoints,
    archivedArea.statistics.definedGridPoints,
    `${grid}: area grid-point count differs`,
  );
  compareNumericTree(
    {
      statistics: operationalArea.statistics,
      distribution: operationalArea.distribution,
    },
    {
      statistics: archivedArea.statistics,
      distribution: archivedArea.distribution,
    },
    `${grid}.area`,
    3e-4,
  );

  return {
    grid,
    run: runIso,
    validTime: f006,
    operationalModel: operationalProfile.model,
    archiveModel: archivedProfile.model,
    operationalSource: operationalProfile.source,
    archiveSource: archivedProfile.source,
    rangeForecastHours: {
      operational: operationalRange.series.map((step: any) => step.forecastHour),
      archive: archivedRange.series.map((step: any) => step.forecastHour),
    },
    areaGridPoints: operationalArea.statistics.definedGridPoints,
  };
}

async function findOverlapRun(grid: Grid): Promise<Date> {
  const now = new Date();
  const failures: string[] = [];
  for (const daysAgo of [3, 4, 5, 6, 7, 8]) {
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysAgo,
      0,
      0,
      0,
      0,
    ));
    const run = candidate.toISOString();
    const validTime = new Date(candidate.getTime() + 6 * HOUR_MS).toISOString();
    try {
      await minimalPoint(grid, "archive", run, validTime);
      await minimalPoint(grid, "s3", run, validTime);
      console.log(`[${grid}] overlap run ${run}`);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${run}: ${message}`);
      console.log(`[${grid}] skipping ${run}: ${message}`);
    }
  }
  throw new Error(
    `Could not find recent operational/archive overlap for GFS ${grid}. Tried:\n${failures.join("\n")}`,
  );
}

async function minimalPoint(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function pointProfile(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    selection: {
      variables: [...PROFILE_VARIABLES],
      pressureLevelsHpa: [...PRESSURE_LEVELS],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function pointFields(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    selection: {
      fields: [
        "surface_pressure",
        "surface_geopotential_height",
        "temperature_2m",
        "specific_humidity_2m",
        "wind_10m",
      ],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function pointRange(
  grid: Grid,
  source: Source,
  run: string,
  from: string,
  to: string,
): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { from, to, maxSteps: 16 },
    selection: {
      variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
      pressureLevelsHpa: [850, 700],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function pointsInstant(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: { type: "points", points: [POINT, SECOND_POINT] },
    time: { at: validTime },
    selection: {
      variables: ["temperature", "relative_humidity", "wind", "geopotential_height"],
      pressureLevelsHpa: [850, 700],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function layerDiagnostic(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await diagnosticService.diagnose({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    diagnostic: {
      kind: "layer",
      lowerPressureHpa: 850,
      upperPressureHpa: 700,
      diagnostics: [
        "temperature_lapse_rate",
        "wind_shear",
        "potential_temperature_gradient",
      ],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function profileDiagnostic(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await diagnosticService.diagnose({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    diagnostic: {
      kind: "profile",
      pressureLevelsHpa: [1000, 925, 850, 700, 500, 300],
      diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function parcelDiagnostic(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await diagnosticService.diagnose({
    dataset: "gfs",
    geometry: { type: "point", ...POINT },
    time: { at: validTime },
    diagnostic: {
      kind: "parcel",
      pressureLevelsHpa: [
        925, 900, 850, 800, 750, 700, 650, 600,
        550, 500, 450, 400, 350, 300, 250, 200,
      ],
      parcel: "surface_2m",
    },
    forecast: { run, grid },
    source,
  });
  return wrapped.result as any;
}

async function areaSummary(grid: Grid, source: Source, run: string, validTime: string): Promise<any> {
  const wrapped = await queryService.query({
    dataset: "gfs",
    geometry: {
      type: "area",
      westLongitude: 13.5,
      eastLongitude: 14.5,
      southLatitude: 49.5,
      northLatitude: 50.5,
    },
    time: { at: validTime },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    aggregate: {
      percentiles: [10, 50, 90],
      thresholds: [{ operator: "gte", value: 0 }],
      includeExtremaLocations: true,
    },
    forecast: { run, grid },
    source,
    limits: { maxGridPoints: 100 },
  });
  return wrapped.result as any;
}

function compareFieldResults(left: any[] | undefined, right: any[] | undefined, path: string): void {
  assert(left && right, `${path}: fields missing`);
  assert.deepEqual(left.map((field) => field.id), right.map((field) => field.id));
  for (let index = 0; index < left.length; index += 1) {
    assert.deepEqual(left[index].level, right[index].level);
    assert.deepEqual(left[index].temporal, right[index].temporal);
    compareNumericTree(left[index].values, right[index].values, `${path}.${left[index].id}`, 2e-4);
  }
}

function stripParcelPath(parcel: any): any {
  const { parcelPath: _parcelPath, ...rest } = parcel;
  return rest;
}

function compareNumericTree(left: any, right: any, path: string, absoluteTolerance: number): void {
  if (typeof left === "number" || typeof right === "number") {
    assert.equal(typeof left, "number", `${path}: left is not numeric`);
    assert.equal(typeof right, "number", `${path}: right is not numeric`);
    close(left, right, path, absoluteTolerance);
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    assert(Array.isArray(left) && Array.isArray(right), `${path}: array shape differs`);
    assert.equal(left.length, right.length, `${path}: array length differs`);
    for (let index = 0; index < left.length; index += 1) {
      compareNumericTree(left[index], right[index], `${path}[${index}]`, absoluteTolerance);
    }
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (["source", "model", "caveat", "dataset", "cacheHit", "requestedPoint"].includes(key)) continue;
      const leftValue = left[key];
      const rightValue = right[key];
      if (typeof leftValue === "number" || typeof rightValue === "number"
          || Array.isArray(leftValue) || Array.isArray(rightValue)
          || (leftValue && typeof leftValue === "object")
          || (rightValue && typeof rightValue === "object")) {
        assert(key in left && key in right, `${path}.${key}: key missing on one side`);
        compareNumericTree(leftValue, rightValue, `${path}.${key}`, absoluteTolerance);
      } else {
        assert.deepEqual(leftValue, rightValue, `${path}.${key}: semantic value differs`);
      }
    }
    return;
  }
  assert.deepEqual(left, right, `${path}: value differs`);
}

function close(left: number, right: number, path: string, absoluteTolerance: number): void {
  assert(Number.isFinite(left) && Number.isFinite(right), `${path}: non-finite value`);
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  const tolerance = Math.max(absoluteTolerance, scale * 1e-7);
  assert(
    Math.abs(left - right) <= tolerance,
    `${path}: ${left} != ${right}; delta=${Math.abs(left - right)}, tolerance=${tolerance}`,
  );
}
