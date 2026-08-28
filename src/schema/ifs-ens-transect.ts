import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import {
  IFS_ENS_POINTS_DEFAULT_MAX_MEMBER_SAMPLES,
  IFS_ENS_POINTS_MAX,
  IFS_ENS_POINTS_MAX_MEMBER_SAMPLES,
  ifsEnsPointsResultSchema,
} from "./ifs-ens-points.js";
import { ifsEnsMemberSchema, ifsEnsSelectionSchema } from "./ifs-ens.js";
import { ifsRunSelectorSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const IFS_ENS_DEFAULT_TRANSECT_SAMPLES = 20;
export const IFS_ENS_MAX_TRANSECT_SAMPLES = IFS_ENS_POINTS_MAX;

export const ifsEnsTransectQuerySchema = z.object({
  start: pointCoordinateSchema,
  end: pointCoordinateSchema,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  selection: ifsEnsSelectionSchema,
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false),
  maxMemberSamples: z.number().int().min(1).max(IFS_ENS_POINTS_MAX_MEMBER_SAMPLES)
    .default(IFS_ENS_POINTS_DEFAULT_MAX_MEMBER_SAMPLES),
  samples: z.number().int().min(2).max(IFS_ENS_MAX_TRANSECT_SAMPLES)
    .default(IFS_ENS_DEFAULT_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
  if (query.start.latitude === query.end.latitude && query.start.longitude === query.end.longitude) {
    context.addIssue({ code: "custom", path: ["end"], message: "Transect start and end coordinates must differ" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
});

const sampleSchema = ifsEnsPointsResultSchema.shape.points.element.omit({ allCacheHit: true }).extend({
  index: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  distanceKm: z.number().nonnegative(),
});

export const ifsEnsTransectResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  startPoint: pointCoordinateSchema,
  endPoint: pointCoordinateSchema,
  totalDistanceKm: z.number().nonnegative(),
  selection: ifsEnsPointsResultSchema.shape.selection,
  includeMembers: z.boolean(),
  samples: z.array(sampleSchema).min(2).max(IFS_ENS_MAX_TRANSECT_SAMPLES),
  source: ifsEnsPointsResultSchema.shape.source,
});

export type IfsEnsTransectQueryInput = z.input<typeof ifsEnsTransectQuerySchema>;
export type IfsEnsTransectResult = z.infer<typeof ifsEnsTransectResultSchema>;
