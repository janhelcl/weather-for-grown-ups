import * as z from "zod/v4";
import { LAYER_DIAGNOSTIC_IDS } from "../catalog/layer-diagnostics.js";
import { PARCEL_DEFINITION_IDS } from "../catalog/parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS } from "../catalog/profile-diagnostics.js";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  ATMOSPHERIC_DATASET_IDS,
  type AtmosphericDatasetId,
  type AtmosphericDatasetKind,
  type AtmosphericDatasetRole,
} from "../catalog/models.js";
import { areaThresholdSchema } from "./area-summary.js";
import { gfsGridSchema } from "./gfs-grid.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const PUBLIC_ATMOSPHERIC_DATASET_IDS = ["gfs", "gefs", "ifs", "ifs-ens", "gfs-analysis"] as const;
export const publicAtmosphericDatasetSchema = z.enum(PUBLIC_ATMOSPHERIC_DATASET_IDS);
export type PublicAtmosphericDataset = z.infer<typeof publicAtmosphericDatasetSchema>;

function datasetMetadata<Id extends AtmosphericDatasetId>(internalDatasetId: Id): {
  internalDatasetId: Id;
  role: AtmosphericDatasetRole;
  kind: AtmosphericDatasetKind;
} {
  const dataset = ATMOSPHERIC_DATASET_CATALOG[internalDatasetId];
  return {
    internalDatasetId,
    role: dataset.role,
    kind: dataset.kind,
  };
}

export const PUBLIC_DATASET_METADATA = {
  gfs: datasetMetadata("gfs_0p25"),
  gefs: datasetMetadata("gefs_0p50"),
  ifs: datasetMetadata("ifs_0p25"),
  "ifs-ens": datasetMetadata("ifs_ens_0p25"),
  "gfs-analysis": datasetMetadata("gfs_grid4_analysis_0p5"),
} as const;

const pointGeometrySchema = z.object({
  type: z.literal("point"),
  ...pointCoordinateSchema.shape,
});

const pointsGeometrySchema = z.object({
  type: z.literal("points"),
  points: z.array(pointCoordinateSchema).min(1).max(50),
});

const transectGeometrySchema = z.object({
  type: z.literal("transect"),
  start: pointCoordinateSchema,
  end: pointCoordinateSchema,
  samples: z.number().int().min(2).max(50).optional(),
}).superRefine((geometry, context) => {
  if (
    geometry.start.latitude === geometry.end.latitude
    && geometry.start.longitude === geometry.end.longitude
  ) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "Transect start and end coordinates must differ",
    });
  }
});

const areaGeometrySchema = z.object({
  type: z.literal("area"),
  westLongitude: z.number().min(-180).max(180),
  eastLongitude: z.number().min(-180).max(180),
  southLatitude: z.number().min(-90).max(90),
  northLatitude: z.number().min(-90).max(90),
}).superRefine((geometry, context) => {
  if (geometry.eastLongitude <= geometry.westLongitude) {
    context.addIssue({
      code: "custom",
      path: ["eastLongitude"],
      message: "eastLongitude must be greater than westLongitude; antimeridian-crossing boxes are not supported yet",
    });
  }
  if (geometry.northLatitude <= geometry.southLatitude) {
    context.addIssue({
      code: "custom",
      path: ["northLatitude"],
      message: "northLatitude must be greater than southLatitude",
    });
  }
});

export const atmosphericGeometrySchema = z.union([
  pointGeometrySchema,
  pointsGeometrySchema,
  transectGeometrySchema,
  areaGeometrySchema,
]);

const historicalHourSchema = z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(18)]);

export const atmosphericInstantTimeSchema = z.object({
  at: isoDateTimeSchema.describe("Atmospheric state valid at this time"),
});

export const atmosphericRangeTimeSchema = z.object({
  from: isoDateTimeSchema.describe("Inclusive start of the valid-time range"),
  to: isoDateTimeSchema.describe("Inclusive end of the valid-time range"),
  hoursUtc: z.array(historicalHourSchema).min(1).max(4).optional().describe(
    "Historical-analysis only: native 00/06/12/18 UTC cycles to sample",
  ),
  maxSteps: z.number().int().min(1).max(209).optional(),
}).superRefine((time, context) => {
  if (new Date(time.to).getTime() < new Date(time.from).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "to must be at or after from",
    });
  }
  if (time.hoursUtc !== undefined && new Set(time.hoursUtc).size !== time.hoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["hoursUtc"],
      message: "hoursUtc must not contain duplicates",
    });
  }
});

export const atmosphericTimeSchema = z.union([
  atmosphericInstantTimeSchema,
  atmosphericRangeTimeSchema,
]);

export const atmosphericSelectionSchema = z.object({
  variables: z.array(z.string().min(1)).min(1).optional(),
  pressureLevelsHpa: z.array(z.number().positive()).min(1).optional(),
  fields: z.array(z.string().min(1)).min(1).optional(),
}).superRefine((selection, context) => {
  const hasVariables = selection.variables !== undefined;
  const hasLevels = selection.pressureLevelsHpa !== undefined;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Pressure-level variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && selection.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one pressure-level variable or non-isobaric field",
    });
  }
  if (selection.variables !== undefined && new Set(selection.variables).size !== selection.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "variables must not contain duplicates" });
  }
  if (
    selection.pressureLevelsHpa !== undefined
    && new Set(selection.pressureLevelsHpa).size !== selection.pressureLevelsHpa.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "pressureLevelsHpa must not contain duplicates",
    });
  }
  if (selection.fields !== undefined && new Set(selection.fields).size !== selection.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "fields must not contain duplicates" });
  }
});

export const atmosphericForecastOptionsSchema = z.object({
  run: z.string().min(1).default("latest").describe(
    "Forecast initialization: latest, latest_complete where supported, or an explicit ISO cycle",
  ),
  grid: gfsGridSchema.optional().describe("GFS-only horizontal grid override: 0p25 (default when omitted) or 0p50"),
});

export const atmosphericEnsembleOptionsSchema = z.object({
  members: z.array(z.string().min(1)).min(2).max(50).optional(),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).optional(),
  includeMembers: z.boolean().optional(),
  maxMemberSamples: z.number().int().min(1).max(20_000).optional(),
}).superRefine((ensemble, context) => {
  if (ensemble.members !== undefined && new Set(ensemble.members).size !== ensemble.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "members must not contain duplicates" });
  }
  if (ensemble.quantiles !== undefined && new Set(ensemble.quantiles).size !== ensemble.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "quantiles must not contain duplicates" });
  }
});

export const atmosphericLimitsSchema = z.object({
  maxSamples: z.number().int().min(1).max(5_000).optional(),
  maxPointSteps: z.number().int().min(1).max(5_000).optional(),
  maxGridPoints: z.number().int().min(1).max(1_100_000).optional(),
  maxMemberGridPoints: z.number().int().min(2).max(2_000_000).optional(),
}).optional();

export const atmosphericAggregationSchema = z.object({
  percentiles: z.array(z.number().min(0).max(100)).max(20).optional(),
  thresholds: z.array(areaThresholdSchema).max(20).optional(),
  includeExtremaLocations: z.boolean().optional(),
}).optional();

export const queryAtmosphereSchema = z.object({
  dataset: publicAtmosphericDatasetSchema,
  geometry: atmosphericGeometrySchema,
  time: atmosphericTimeSchema,
  selection: atmosphericSelectionSchema,
  forecast: atmosphericForecastOptionsSchema.optional(),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  source: z.enum(["nomads", "s3", "archive"]).optional().describe("GFS-only source override; archive forces the resolution-matched historical backend"),
  aggregate: atmosphericAggregationSchema,
  limits: atmosphericLimitsSchema,
}).superRefine(validateCommonAtmosphericRequest);

export const atmosphericDiagnosticSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("layer"),
    lowerPressureHpa: z.number().positive(),
    upperPressureHpa: z.number().positive(),
    diagnostics: z.array(z.enum(LAYER_DIAGNOSTIC_IDS)).min(1),
  }).superRefine((diagnostic, context) => {
    if (diagnostic.lowerPressureHpa <= diagnostic.upperPressureHpa) {
      context.addIssue({
        code: "custom",
        path: ["upperPressureHpa"],
        message: "lowerPressureHpa must be greater than upperPressureHpa",
      });
    }
  }),
  z.object({
    kind: z.literal("profile"),
    pressureLevelsHpa: z.array(z.number().positive()).min(2),
    diagnostics: z.array(z.enum(PROFILE_DIAGNOSTIC_IDS)).min(1),
  }),
  z.object({
    kind: z.literal("parcel"),
    pressureLevelsHpa: z.array(z.number().positive()).min(2),
    parcel: z.enum(PARCEL_DEFINITION_IDS),
  }),
]);

export const diagnoseAtmosphereSchema = z.object({
  dataset: publicAtmosphericDatasetSchema,
  geometry: pointGeometrySchema,
  time: atmosphericTimeSchema,
  diagnostic: atmosphericDiagnosticSelectionSchema,
  forecast: atmosphericForecastOptionsSchema.optional(),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  source: z.enum(["nomads", "s3", "archive"]).optional().describe("GFS-only source override; archive forces the resolution-matched historical backend"),
}).superRefine((request, context) => {
  validateDatasetModifiers(request, context);
  if ("from" in request.time && request.ensemble?.includeMembers === true) {
    context.addIssue({
      code: "custom",
      path: ["ensemble", "includeMembers"],
      message: "Ensemble diagnostic time series return compact member-first summaries; use a single-time diagnostic query to include member payloads",
    });
  }
});

export const UNIFIED_ATMOSPHERE_INTERNAL_DATASET_IDS = [
  ...ATMOSPHERIC_DATASET_IDS,
  "gfs_0p25_forecast_archive",
  "gfs_grid4_forecast_0p5_archive",
] as const;

export const unifiedAtmosphereResultSchema = z.object({
  dataset: publicAtmosphericDatasetSchema,
  internalDatasetId: z.enum(UNIFIED_ATMOSPHERE_INTERNAL_DATASET_IDS),
  role: z.enum(["forecast", "analysis"]),
  kind: z.enum(["deterministic", "ensemble"]),
  geometryType: z.enum(["point", "points", "transect", "area"]),
  timeType: z.enum(["instant", "range"]),
  result: z.unknown(),
});

export function publicDatasetMetadata(dataset: PublicAtmosphericDataset) {
  return PUBLIC_DATASET_METADATA[dataset];
}

function validateCommonAtmosphericRequest(
  request: any,
  context: z.RefinementCtx,
): void {
  validateDatasetModifiers(request, context);

  const isRange = "from" in request.time;
  if (isRange && (request.geometry.type === "transect" || request.geometry.type === "area")) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: `${request.geometry.type} queries currently support one valid time, not a time range`,
    });
  }

  if (request.aggregate !== undefined && request.geometry.type !== "area") {
    context.addIssue({
      code: "custom",
      path: ["aggregate"],
      message: "aggregate is only valid for area geometry",
    });
  }

  if (request.geometry.type === "area") {
    const variableCount = request.selection.variables?.length ?? 0;
    const levelCount = request.selection.pressureLevelsHpa?.length ?? 0;
    const fieldCount = request.selection.fields?.length ?? 0;
    const pressureSelection = variableCount === 1 && levelCount === 1 && fieldCount === 0;
    const fieldSelection = variableCount === 0 && levelCount === 0 && fieldCount === 1;
    if (!pressureSelection && !fieldSelection) {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: "Area geometry requires exactly one pressure variable at one pressure level or exactly one field",
      });
    }
  }
}

function validateDatasetModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  const metadata = publicDatasetMetadata(request.dataset as PublicAtmosphericDataset);
  if (metadata.role === "analysis" && request.forecast !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["forecast"],
      message: "Historical GFS analysis has no forecast initialization or lead axis",
    });
  }
  if (metadata.role !== "analysis" && "from" in request.time && request.time.hoursUtc !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["time", "hoursUtc"],
      message: "hoursUtc is only valid for gfs-analysis ranges",
    });
  }
  if (request.dataset !== "gfs" && request.forecast?.grid !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["forecast", "grid"],
      message: "forecast.grid is only configurable for the gfs dataset",
    });
  }
  if (metadata.kind !== "ensemble" && request.ensemble !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["ensemble"],
      message: "ensemble controls are only valid for ensemble datasets: gefs or ifs-ens",
    });
  }
  if (request.dataset !== "gfs" && request.source !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "source override is only valid for gfs",
    });
  }
}

export type QueryAtmosphereInput = z.input<typeof queryAtmosphereSchema>;
export type QueryAtmosphereRequest = z.output<typeof queryAtmosphereSchema>;
export type DiagnoseAtmosphereInput = z.input<typeof diagnoseAtmosphereSchema>;
export type DiagnoseAtmosphereRequest = z.output<typeof diagnoseAtmosphereSchema>;
export type UnifiedAtmosphereResult = z.infer<typeof unifiedAtmosphereResultSchema>;
