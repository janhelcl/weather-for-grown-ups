import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_STANDARD_MEMBERS,
} from "../sources/gefs-reforecast-s3.js";
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
