import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
  GEFS_REFORECAST_STANDARD_MEMBERS,
  isSupportedGefsReforecastPressureSelection,
} from "../catalog/gefs-reforecast.js";
import {
  gefsFieldSummarySchema,
  gefsFieldTemporalResultSchema,
} from "./gefs-member-bundle.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gefsReforecastMemberSchema = z.enum(GEFS_REFORECAST_EXTENDED_MEMBERS);
export const gefsReforecastFieldSchema = z.enum(GEFS_REFORECAST_FIELD_IDS);

export const gefsReforecastPointQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: isoDateTimeSchema.describe("Explicit GEFSv12 reforecast initialization; public AWS reforecasts are daily 00Z runs from 2000 through 2019"),
  validTime: isoDateTimeSchema,
  fields: z.array(gefsReforecastFieldSchema).min(1).max(GEFS_REFORECAST_FIELD_IDS.length),
  members: z.array(gefsReforecastMemberSchema)
    .min(2)
    .max(GEFS_REFORECAST_EXTENDED_MEMBERS.length)
    .default([...GEFS_REFORECAST_STANDARD_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
}).superRefine((query, context) => {
  if (new Set(query.fields).size !== query.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "GEFSv12 reforecast fields must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFSv12 reforecast members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
});

export const gefsReforecastPointResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    fields: z.array(gefsReforecastFieldSchema).min(1),
    members: z.array(gefsReforecastMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  fieldSummaries: z.array(gefsFieldSummarySchema).min(1),
  members: z.array(z.object({
    member: gefsReforecastMemberSchema,
    cacheHit: z.boolean(),
    fields: z.array(z.object({
      field: gefsReforecastFieldSchema,
      temporal: gefsFieldTemporalResultSchema,
      values: z.record(z.string(), z.number()),
    })).min(1),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    archiveType: z.literal("reforecast"),
    dataset: z.literal("GEFSv12/reforecast"),
    leadBlock: z.enum(["Days:1-10", "Days:10-16"]),
    horizontalGridDegrees: z.union([z.literal(0.25), z.literal(0.5)]),
    allCacheHit: z.boolean(),
  }),
});

export type GefsReforecastPointQueryInput = z.input<typeof gefsReforecastPointQuerySchema>;
export type GefsReforecastPointResult = z.infer<typeof gefsReforecastPointResultSchema>;


export const gefsReforecastProfileVariableSchema =
  z.enum(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS);

export const gefsReforecastProfileQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: isoDateTimeSchema.describe(
    "Explicit GEFSv12 reforecast initialization; public AWS reforecasts are daily 00Z runs from 2000 through 2019",
  ),
  validTime: isoDateTimeSchema,
  variables: z.array(gefsReforecastProfileVariableSchema)
    .min(1)
    .max(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS.length),
  pressureLevelsHpa: z.array(z.number().positive()).min(1).max(25),
  members: z.array(gefsReforecastMemberSchema)
    .min(2)
    .max(GEFS_REFORECAST_EXTENDED_MEMBERS.length)
    .default([...GEFS_REFORECAST_STANDARD_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
}).superRefine((query, context) => {
  if (new Set(query.variables).size !== query.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "GEFSv12 reforecast profile variables must not contain duplicates" });
  }
  if (new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({ code: "custom", path: ["pressureLevelsHpa"], message: "GEFSv12 reforecast pressure levels must not contain duplicates" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "GEFSv12 reforecast members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
  for (const variable of query.variables) {
    for (const pressureLevelHpa of query.pressureLevelsHpa) {
      if (!isSupportedGefsReforecastPressureSelection(variable, pressureLevelHpa)) {
        context.addIssue({
          code: "custom",
          path: ["pressureLevelsHpa"],
          message: `GEFSv12 reforecast cannot satisfy ${variable} at ${pressureLevelHpa} hPa`,
        });
      }
    }
  }
});

const reforecastProfileQuantileSchema = z.object({
  quantile: z.number().min(0).max(1),
  value: z.number(),
});

const reforecastProfileSummarySchema = z.object({
  variable: gefsReforecastProfileVariableSchema,
  gfsCode: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  outputField: z.string().min(1),
  unit: z.string().min(1),
  memberCount: z.number().int().min(2),
  mean: z.number(),
  populationStdDev: z.number().nonnegative(),
  min: z.number(),
  max: z.number(),
  quantiles: z.array(reforecastProfileQuantileSchema).min(1),
});

const reforecastProfileMemberValueSchema = z.object({
  variable: gefsReforecastProfileVariableSchema,
  pressureLevelHpa: z.number().positive(),
  value: z.number(),
});

export const gefsReforecastProfileResultSchema = z.object({
  model: z.literal("gefs_v12_reforecast"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(3).max(384),
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: z.object({
    variables: z.array(gefsReforecastProfileVariableSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
    members: z.array(gefsReforecastMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  summaries: z.array(reforecastProfileSummarySchema).min(1),
  members: z.array(z.object({
    member: gefsReforecastMemberSchema,
    cacheHit: z.boolean(),
    values: z.array(reforecastProfileMemberValueSchema).min(1),
  })).min(2).optional(),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    archiveType: z.literal("reforecast"),
    dataset: z.literal("GEFSv12/reforecast"),
    leadBlock: z.enum(["Days:1-10", "Days:10-16"]),
    horizontalGridDegrees: z.union([z.literal(0.25), z.literal(0.5)]),
    profileGridPolicy: z.enum(["native_0p25", "native_0p50", "coherent_0p50"]),
    allCacheHit: z.boolean(),
  }),
});

export type GefsReforecastProfileQueryInput =
  z.input<typeof gefsReforecastProfileQuerySchema>;
export type GefsReforecastProfileResult =
  z.infer<typeof gefsReforecastProfileResultSchema>;
