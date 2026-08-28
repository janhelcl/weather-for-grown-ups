import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { ifsEnsMemberSchema, ifsEnsMemberBundleResultSchema, ifsEnsSelectionSchema } from "./ifs-ens.js";
import { ifsRunSelectorSchema } from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const IFS_ENS_MAX_NATIVE_STEPS = 85;
export const IFS_ENS_TIME_SERIES_DEFAULT_MAX_STEPS = 40;
export const IFS_ENS_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES = 5_000;
export const IFS_ENS_TIME_SERIES_MAX_MEMBER_SAMPLES = 20_000;

export const ifsEnsTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema.describe("Inclusive requested start of the ECMWF ENS valid-time range"),
  endTime: isoDateTimeSchema.describe("Inclusive requested end of the ECMWF ENS valid-time range"),
  selection: ifsEnsSelectionSchema,
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  includeMembers: z.boolean().default(false).describe(
    "Include raw normalized perturbation values at every native step. False is recommended for agent context efficiency.",
  ),
  maxSteps: z.number().int().min(1).max(IFS_ENS_MAX_NATIVE_STEPS).default(IFS_ENS_TIME_SERIES_DEFAULT_MAX_STEPS),
  maxMemberSamples: z.number().int().min(1).max(IFS_ENS_TIME_SERIES_MAX_MEMBER_SAMPLES).default(
    IFS_ENS_TIME_SERIES_DEFAULT_MAX_MEMBER_SAMPLES,
  ).describe(
    "Guardrail for includeMembers: maximum native-step × perturbation × scalar-output cells returned",
  ),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be at or after startTime" });
  }
  if (new Set(query.members).size !== query.members.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "IFS ENS members must not contain duplicates" });
  }
  if (new Set(query.quantiles).size !== query.quantiles.length) {
    context.addIssue({ code: "custom", path: ["quantiles"], message: "Quantiles must not contain duplicates" });
  }
});

const stepSchema = z.object({
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  pressureSummaries: ifsEnsMemberBundleResultSchema.shape.pressureSummaries,
  fieldSummaries: ifsEnsMemberBundleResultSchema.shape.fieldSummaries,
  members: ifsEnsMemberBundleResultSchema.shape.members,
  allCacheHit: z.boolean(),
});

export const ifsEnsTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  selection: ifsEnsMemberBundleResultSchema.shape.selection,
  includeMembers: z.boolean(),
  series: z.array(stepSchema).min(1).max(IFS_ENS_MAX_NATIVE_STEPS),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    allCacheHit: z.boolean(),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
  }),
});

export type IfsEnsTimeSeriesQueryInput = z.input<typeof ifsEnsTimeSeriesQuerySchema>;
export type IfsEnsTimeSeriesResult = z.infer<typeof ifsEnsTimeSeriesResultSchema>;
