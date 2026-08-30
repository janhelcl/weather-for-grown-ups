import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
  GEFS_REFORECAST_STANDARD_MEMBERS,
  isSupportedGefsReforecastPressureSelection,
} from "../catalog/gefs-reforecast.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import {
  GEFS_REFORECAST_TIME_SERIES_DEFAULT_MAX_STEPS,
  GEFS_REFORECAST_TIME_SERIES_MAX_STEPS,
  gefsReforecastMemberSchema,
} from "./gefs-reforecast.js";
import {
  gefsLayerDiagnosticsResultSchema,
} from "./gefs-layer-diagnostics.js";
import {
  gefsProfileDiagnosticSummarySchema,
} from "./gefs-profile-diagnostics.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  pointCoordinateSchema,
  profileDiagnosticIdSchema,
} from "./query.js";
import { profileDiagnosticResultSchema, profileLevelResultSchema } from "./result.js";

const reforecastMembersSchema = z.array(gefsReforecastMemberSchema)
  .min(2)
  .max(GEFS_REFORECAST_EXTENDED_MEMBERS.length)
  .default([...GEFS_REFORECAST_STANDARD_MEMBERS]);

const quantilesSchema = z.array(z.number().min(0).max(1))
  .min(1)
  .max(9)
  .default([0.1, 0.5, 0.9]);

const reforecastDiagnosticSourceSchema = z.object({
  provider: z.literal("NOAA AWS Open Data"),
  access: z.literal("s3_range"),
  decoder: z.enum(["gribberish", "wgrib2"]),
  archiveType: z.literal("reforecast"),
  dataset: z.literal("GEFSv12/reforecast"),
  leadBlock: z.enum(["Days:1-10", "Days:10-16"]),
  horizontalGridDegrees: z.union([z.literal(0.25), z.literal(0.5)]),
  profileGridPolicy: z.enum(["native_0p25", "native_0p50", "coherent_0p50"]),
  allCacheHit: z.boolean(),
});

function validateCommon(
  members: readonly string[],
  quantiles: readonly number[],
  context: z.RefinementCtx,
): void {
  if (new Set(members).size !== members.length) {
    context.addIssue({
      code: "custom",
      path: ["members"],
      message: "GEFSv12 reforecast diagnostic members must not contain duplicates",
    });
  }
  if (new Set(quantiles).size !== quantiles.length) {
    context.addIssue({
      code: "custom",
      path: ["quantiles"],
      message: "GEFSv12 reforecast diagnostic quantiles must not contain duplicates",
    });
  }
}

function validateRequiredVariables(
  variables: readonly string[],
  pressureLevelsHpa: readonly number[],
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  const supported = new Set<string>(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS);
  for (const variable of variables) {
    if (!supported.has(variable)) {
      context.addIssue({
        code: "custom",
        path,
        message: `GEFSv12 reforecast diagnostics do not support required variable ${variable}`,
      });
      continue;
    }
    for (const pressureLevelHpa of pressureLevelsHpa) {
      if (!isSupportedGefsReforecastPressureSelection(variable as any, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFSv12 reforecast does not publish required ${variable} at ${pressureLevelHpa} hPa for this diagnostic selection`,
        });
      }
    }
  }
}

export const gefsReforecastLayerDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: isoDateTimeSchema.describe("Explicit GEFSv12 reforecast initialization"),
  validTime: isoDateTimeSchema,
  lowerPressureHpa: z.number().positive(),
  upperPressureHpa: z.number().positive(),
  diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  members: reforecastMembersSchema,
  quantiles: quantilesSchema,
  includeMembers: z.boolean().default(false),
}).superRefine((query, context) => {
  if (query.lowerPressureHpa <= query.upperPressureHpa) {
    context.addIssue({
      code: "custom",
      path: ["upperPressureHpa"],
      message: "lowerPressureHpa must be greater than upperPressureHpa",
    });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message: "GEFSv12 reforecast layer diagnostic selection must not contain duplicates",
    });
  }
  validateCommon(query.members, query.quantiles, context);
  validateRequiredVariables(
    expandLayerDiagnosticVariables(query.diagnostics),
    [query.lowerPressureHpa, query.upperPressureHpa],
    ["diagnostics"],
    context,
  );
});

export const gefsReforecastLayerDiagnosticsResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  pressureLayer: gefsLayerDiagnosticsResultSchema.shape.pressureLayer,
  selection: z.object({
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
    members: z.array(gefsReforecastMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  layerDepthGpm: gefsLayerDiagnosticsResultSchema.shape.layerDepthGpm,
  summaries: gefsLayerDiagnosticsResultSchema.shape.summaries,
  members: z.array(z.object({
    member: gefsReforecastMemberSchema,
    cacheHit: z.boolean(),
    layer: z.object({
      lowerPressureHpa: z.number().positive(),
      upperPressureHpa: z.number().positive(),
      lowerGeopotentialHeightGpm: z.number(),
      upperGeopotentialHeightGpm: z.number(),
      depthGpm: z.number().positive(),
    }),
    diagnostics: z.array(z.object({
      id: layerDiagnosticIdSchema,
      values: z.record(z.string(), z.number()),
    })).min(1),
  })).min(2).optional(),
  source: reforecastDiagnosticSourceSchema,
});

export const gefsReforecastProfileDiagnosticsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: isoDateTimeSchema.describe("Explicit GEFSv12 reforecast initialization"),
  validTime: isoDateTimeSchema,
  pressureLevelsHpa: z.array(z.number().positive()).min(2).max(25),
  diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  members: reforecastMembersSchema,
  quantiles: quantilesSchema,
  includeMembers: z.boolean().default(false),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "GEFSv12 reforecast profile diagnostic pressure levels must not contain duplicates",
    });
  }
  if (new Set(query.diagnostics).size !== query.diagnostics.length) {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message: "GEFSv12 reforecast profile diagnostic selection must not contain duplicates",
    });
  }
  validateCommon(query.members, query.quantiles, context);
  validateRequiredVariables(
    expandProfileDiagnosticVariables(query.diagnostics),
    query.pressureLevelsHpa,
    ["diagnostics"],
    context,
  );
});

export const gefsReforecastProfileDiagnosticsResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  selection: z.object({
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
    members: z.array(gefsReforecastMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  summaries: z.array(gefsProfileDiagnosticSummarySchema).min(1),
  members: z.array(z.object({
    member: gefsReforecastMemberSchema,
    cacheHit: z.boolean(),
    levels: z.array(profileLevelResultSchema).min(2),
    diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  })).min(2).optional(),
  source: reforecastDiagnosticSourceSchema,
});

export const gefsReforecastDiagnosticTimeSeriesSelectionSchema =
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("layer"),
      lowerPressureHpa: z.number().positive(),
      upperPressureHpa: z.number().positive(),
      diagnostics: z.array(layerDiagnosticIdSchema).min(1),
    }),
    z.object({
      kind: z.literal("profile"),
      pressureLevelsHpa: z.array(z.number().positive()).min(2).max(25),
      diagnostics: z.array(profileDiagnosticIdSchema).min(1),
    }),
  ]);

export const gefsReforecastDiagnosticTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: isoDateTimeSchema.describe("Explicit GEFSv12 reforecast initialization"),
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  diagnostic: gefsReforecastDiagnosticTimeSeriesSelectionSchema,
  members: reforecastMembersSchema,
  quantiles: quantilesSchema,
  maxSteps: z.number().int().min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS)
    .default(GEFS_REFORECAST_TIME_SERIES_DEFAULT_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be at or after startTime",
    });
  }
  validateCommon(query.members, query.quantiles, context);
  const common = {
    latitude: query.latitude,
    longitude: query.longitude,
    run: query.run,
    validTime: query.startTime,
    members: query.members,
    quantiles: query.quantiles,
    includeMembers: false,
  };
  const validated = query.diagnostic.kind === "layer"
    ? gefsReforecastLayerDiagnosticsQuerySchema.safeParse({
        ...common,
        ...query.diagnostic,
      })
    : gefsReforecastProfileDiagnosticsQuerySchema.safeParse({
        ...common,
        ...query.diagnostic,
      });
  if (!validated.success) {
    for (const issue of validated.error.issues) {
      context.addIssue({
        code: "custom",
        path: [
          "diagnostic",
          ...issue.path.filter((part) =>
            !["latitude", "longitude", "run", "validTime", "members", "quantiles", "includeMembers"]
              .includes(String(part))),
        ],
        message: issue.message,
      });
    }
  }
});

const stepSourceSchema = reforecastDiagnosticSourceSchema.pick({
  leadBlock: true,
  horizontalGridDegrees: true,
  profileGridPolicy: true,
  allCacheHit: true,
});

const layerStepSchema = z.object({
  kind: z.literal("layer"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  gridPoint: pointCoordinateSchema,
  pressureLayer: gefsReforecastLayerDiagnosticsResultSchema.shape.pressureLayer,
  layerDepthGpm: gefsReforecastLayerDiagnosticsResultSchema.shape.layerDepthGpm,
  summaries: gefsReforecastLayerDiagnosticsResultSchema.shape.summaries,
  source: stepSourceSchema,
});

const profileStepSchema = z.object({
  kind: z.literal("profile"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  gridPoint: pointCoordinateSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  summaries: z.array(gefsProfileDiagnosticSummarySchema).min(1),
  source: stepSourceSchema,
});

export const gefsReforecastDiagnosticTimeSeriesResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  selection: z.object({
    diagnostic: gefsReforecastDiagnosticTimeSeriesSelectionSchema,
    members: z.array(gefsReforecastMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  series: z.array(z.discriminatedUnion("kind", [
    layerStepSchema,
    profileStepSchema,
  ])).min(1).max(GEFS_REFORECAST_TIME_SERIES_MAX_STEPS),
  source: reforecastDiagnosticSourceSchema
    .omit({
      leadBlock: true,
      horizontalGridDegrees: true,
      profileGridPolicy: true,
    })
    .extend({
      nativeCadence: z.tuple([
        z.object({
          fromForecastHour: z.literal(3),
          throughForecastHour: z.literal(240),
          stepHours: z.literal(3),
        }),
        z.object({
          fromForecastHour: z.literal(246),
          throughForecastHour: z.literal(384),
          stepHours: z.literal(6),
        }),
      ]),
    }),
}).superRefine((result, context) => {
  for (const [index, step] of result.series.entries()) {
    if (step.kind !== result.selection.diagnostic.kind) {
      context.addIssue({
        code: "custom",
        path: ["series", index, "kind"],
        message: `GEFSv12 reforecast diagnostic step kind ${step.kind} does not match selection kind ${result.selection.diagnostic.kind}`,
      });
    }
  }
});

export type GefsReforecastLayerDiagnosticsQueryInput =
  z.input<typeof gefsReforecastLayerDiagnosticsQuerySchema>;
export type GefsReforecastLayerDiagnosticsResult =
  z.infer<typeof gefsReforecastLayerDiagnosticsResultSchema>;
export type GefsReforecastProfileDiagnosticsQueryInput =
  z.input<typeof gefsReforecastProfileDiagnosticsQuerySchema>;
export type GefsReforecastProfileDiagnosticsResult =
  z.infer<typeof gefsReforecastProfileDiagnosticsResultSchema>;
export type GefsReforecastDiagnosticTimeSeriesQueryInput =
  z.input<typeof gefsReforecastDiagnosticTimeSeriesQuerySchema>;
export type GefsReforecastDiagnosticTimeSeriesResult =
  z.infer<typeof gefsReforecastDiagnosticTimeSeriesResultSchema>;
