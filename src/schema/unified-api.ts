import * as z from "zod/v4";
import { LAYER_DIAGNOSTIC_IDS } from "../catalog/layer-diagnostics.js";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
  isSupportedGefsReforecastPressureSelection,
} from "../catalog/gefs-reforecast.js";
import { PARCEL_DEFINITION_IDS } from "../catalog/parcel-diagnostics.js";
import { PROFILE_DIAGNOSTIC_IDS } from "../catalog/profile-diagnostics.js";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  ATMOSPHERIC_DATASET_IDS,
  datasetSupportsRunSelector,
  type AtmosphericDatasetId,
  type AtmosphericDatasetKind,
  type AtmosphericDatasetRole,
  type AtmosphericRunSelectorId,
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

export const atmosphericRunSelectorSchema = z.union([
  z.literal("latest"),
  z.literal("latest_complete"),
  isoDateTimeSchema,
]).default("latest").describe(
  "Forecast initialization: latest, latest_complete where supported, or an explicit timezone-aware ISO cycle",
);

export const atmosphericForecastOptionsSchema = z.object({
  kind: z.enum(["operational", "reforecast"]).optional().describe(
    "Forecast population. Omit (or use 'operational') for normal forecasts; 'reforecast' selects the GEFSv12 retrospective ensemble rather than an archive of operational cycles.",
  ),
  run: atmosphericRunSelectorSchema,
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
  source: z.enum(["nomads", "s3", "archive"]).optional().describe("GFS-only source override. Omit for automatic routing: AWS S3 for point/multi-point/time-series/transect access, NOMADS for area subsets, and the resolution-matched archive for explicit old runs."),
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
  source: z.enum(["nomads", "s3", "archive"]).optional().describe("GFS-only source override. Omit for automatic routing: AWS S3 for point/multi-point/time-series/transect access, NOMADS for area subsets, and the resolution-matched archive for explicit old runs."),
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
  "gefs_v12_reforecast",
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

export type PublicForecastKind = "operational" | "reforecast";

export interface PublicAtmosphericDatasetCapabilities {
  dataset: PublicAtmosphericDataset;
  role: AtmosphericDatasetRole;
  kind: AtmosphericDatasetKind;
  forecastKinds: readonly PublicForecastKind[];
  runSelectors: readonly AtmosphericRunSelectorId[];
  operations: readonly string[];
}

export function publicDatasetCapabilities(
  dataset: PublicAtmosphericDataset,
  forecastKind?: PublicForecastKind,
): PublicAtmosphericDatasetCapabilities {
  const metadata = publicDatasetMetadata(dataset);
  const definition = ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId];
  const forecastKinds: readonly PublicForecastKind[] = metadata.role === "analysis"
    ? []
    : dataset === "gefs"
      ? ["operational", "reforecast"]
      : ["operational"];
  const runSelectors: readonly AtmosphericRunSelectorId[] =
    forecastKind === "reforecast" && dataset === "gefs"
      ? ["explicit"]
      : definition.runSelectors;

  return {
    dataset,
    role: metadata.role,
    kind: metadata.kind,
    forecastKinds,
    runSelectors,
    operations: definition.operations,
  };
}

function validateCommonAtmosphericRequest(
  request: any,
  context: z.RefinementCtx,
): void {
  validateDatasetModifiers(request, context);

  if (request.dataset === "gfs" && request.source !== undefined && request.source !== "archive") {
    if (request.geometry.type === "area" && request.source !== "nomads") {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Operational GFS area queries use NOMADS geographic subsetting; omit source for automatic routing or use source=nomads",
      });
    }
    if (
      (request.geometry.type === "points" || request.geometry.type === "transect")
      && request.source !== "s3"
    ) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Operational GFS multi-point and transect queries reuse AWS S3 byte-range slices; omit source for automatic routing or use source=s3",
      });
    }
  }

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
  const isReforecast = request.forecast?.kind === "reforecast";

  if (isReforecast) {
    if (request.dataset !== "gefs") {
      context.addIssue({
        code: "custom",
        path: ["forecast", "kind"],
        message: "forecast.kind=reforecast is currently available only for dataset=gefs",
      });
    }
    if (request.forecast?.run === "latest" || request.forecast?.run === "latest_complete") {
      context.addIssue({
        code: "custom",
        path: ["forecast", "run"],
        message: "GEFSv12 reforecast queries require an explicit historical 00Z initialization",
      });
    }
    if (
      request.geometry?.type !== "point"
      && request.geometry?.type !== "points"
    ) {
      context.addIssue({
        code: "custom",
        path: ["geometry"],
        message: "GEFSv12 reforecast support currently covers point and multi-point geometry; transect and area support will be added without changing the public query vocabulary",
      });
    }
    if (
      request.time !== undefined
      && "from" in request.time
      && request.ensemble?.includeMembers === true
    ) {
      context.addIssue({
        code: "custom",
        path: ["ensemble", "includeMembers"],
        message: "GEFSv12 reforecast time ranges return compact member-first summaries; use one valid time to include raw member payloads",
      });
    }
    if (
      request.diagnostic !== undefined
      && request.diagnostic.kind === "parcel"
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "GEFSv12 reforecast parcel diagnostics are not exposed because the current retrospective subset lacks the required moisture/surface inputs",
      });
    }
    if (request.selection !== undefined) {
      const variables = request.selection.variables ?? [];
      const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
      const fields = request.selection.fields ?? [];
      const supportedFields = new Set<string>(GEFS_REFORECAST_FIELD_IDS);
      const unsupportedFields = fields.filter((field: string) => !supportedFields.has(field));
      if (unsupportedFields.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "fields"],
          message: `GEFSv12 reforecast fields not yet supported: ${unsupportedFields.join(", ")}`,
        });
      }

      const supportedVariables = new Set<string>(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS);
      const unsupportedVariables = variables.filter((variable: string) => !supportedVariables.has(variable));
      if (unsupportedVariables.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "variables"],
          message: `GEFSv12 reforecast pressure variables not supported: ${unsupportedVariables.join(", ")}`,
        });
      }
      for (const variable of variables) {
        if (!supportedVariables.has(variable)) continue;
        for (const pressureLevelHpa of pressureLevelsHpa) {
          if (!isSupportedGefsReforecastPressureSelection(variable as any, pressureLevelHpa)) {
            context.addIssue({
              code: "custom",
              path: ["selection", "pressureLevelsHpa"],
              message: `GEFSv12 reforecast cannot satisfy ${variable} at ${pressureLevelHpa} hPa`,
            });
          }
        }
      }
    }
    if (request.ensemble?.members !== undefined) {
      const supportedMembers = new Set<string>(GEFS_REFORECAST_EXTENDED_MEMBERS);
      const unsupported = request.ensemble.members.filter((member: string) => !supportedMembers.has(member));
      if (unsupported.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["ensemble", "members"],
          message: `GEFSv12 reforecast members are c00,p01..p10; unsupported: ${unsupported.join(", ")}`,
        });
      }
    }
  }
  if (metadata.role === "forecast" && !isReforecast) {
    const run = request.forecast?.run ?? "latest";
    const selector = runSelectorCapability(run);
    if (!datasetSupportsRunSelector(metadata.internalDatasetId, selector)) {
      const supported = ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId].runSelectors
        .map(runSelectorLabel)
        .join(", ");
      context.addIssue({
        code: "custom",
        path: ["forecast", "run"],
        message: `dataset=${request.dataset} does not support run=${run}; supported run selectors: ${supported}`,
      });
    }
  }

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

function runSelectorCapability(value: string): AtmosphericRunSelectorId {
  if (value === "latest" || value === "latest_complete") return value;
  return "explicit";
}

function runSelectorLabel(value: AtmosphericRunSelectorId): string {
  return value === "explicit" ? "explicit ISO cycle" : value;
}

export type QueryAtmosphereInput = z.input<typeof queryAtmosphereSchema>;
export type QueryAtmosphereRequest = z.output<typeof queryAtmosphereSchema>;
export type DiagnoseAtmosphereInput = z.input<typeof diagnoseAtmosphereSchema>;
export type DiagnoseAtmosphereRequest = z.output<typeof diagnoseAtmosphereSchema>;
export type UnifiedAtmosphereResult = z.infer<typeof unifiedAtmosphereResultSchema>;
