import * as z from "zod/v4";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import { IFS_ENS_MAX_NATIVE_STEPS } from "./ifs-ens-timeseries.js";
import {
  ifsEnsLayerDiagnosticsQuerySchema,
  ifsEnsLayerDiagnosticsResultSchema,
  ifsEnsParcelDiagnosticsQuerySchema,
  ifsEnsParcelDiagnosticsResultSchema,
  ifsEnsProfileDiagnosticsQuerySchema,
  ifsEnsProfileDiagnosticsResultSchema,
  ifsEnsProfileDiagnosticSummarySchema,
} from "./ifs-ens-diagnostics.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import { ifsPressureLevelSchema, ifsRunSelectorSchema } from "./ifs.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  parcelDefinitionIdSchema,
  pointCoordinateSchema,
  profileDiagnosticIdSchema,
} from "./query.js";

export const IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS = 40;

export const ifsEnsDiagnosticTimeSeriesSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("layer"),
    lowerPressureHpa: ifsPressureLevelSchema,
    upperPressureHpa: ifsPressureLevelSchema,
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("profile"),
    pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("parcel"),
    pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2).max(14),
    parcel: parcelDefinitionIdSchema,
  }),
]);

export const ifsEnsDiagnosticTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
  diagnostic: ifsEnsDiagnosticTimeSeriesSelectionSchema,
  members: z.array(ifsEnsMemberSchema).min(2).max(IFS_ENS_MEMBERS.length).default([...IFS_ENS_MEMBERS]),
  quantiles: z.array(z.number().min(0).max(1)).min(1).max(9).default([0.1, 0.5, 0.9]),
  maxSteps: z.number().int().min(1).max(IFS_ENS_MAX_NATIVE_STEPS).default(
    IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS,
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
    ? ifsEnsLayerDiagnosticsQuerySchema.safeParse({ ...common, ...query.diagnostic })
    : query.diagnostic.kind === "profile"
      ? ifsEnsProfileDiagnosticsQuerySchema.safeParse({ ...common, ...query.diagnostic })
      : ifsEnsParcelDiagnosticsQuerySchema.safeParse({ ...common, ...query.diagnostic });

  if (!validated.success) {
    for (const issue of validated.error.issues) {
      context.addIssue({
        code: "custom",
        path: [
          "diagnostic",
          ...issue.path.filter((part) =>
            !["latitude", "longitude", "run", "validTime", "members", "quantiles", "includeMembers"].includes(String(part))),
        ],
        message: issue.message,
      });
    }
  }
});

const layerStepSchema = z.object({
  kind: z.literal("layer"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  pressureLayer: ifsEnsLayerDiagnosticsResultSchema.shape.pressureLayer,
  layerDepthGpm: ifsEnsLayerDiagnosticsResultSchema.shape.layerDepthGpm,
  summaries: ifsEnsLayerDiagnosticsResultSchema.shape.summaries,
  allCacheHit: z.boolean(),
});

const profileStepSchema = z.object({
  kind: z.literal("profile"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  sampledPressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2),
  summaries: z.array(ifsEnsProfileDiagnosticSummarySchema).min(1),
  allCacheHit: z.boolean(),
});

const parcelStepSchema = z.object({
  kind: z.literal("parcel"),
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  sampledPressureLevelsHpa: z.array(ifsPressureLevelSchema).min(2),
  summary: ifsEnsParcelDiagnosticsResultSchema.shape.summary,
  allCacheHit: z.boolean(),
});

export const ifsEnsDiagnosticTimeSeriesStepSchema = z.discriminatedUnion("kind", [
  layerStepSchema,
  profileStepSchema,
  parcelStepSchema,
]);

export const ifsEnsDiagnosticTimeSeriesResultSchema = z.object({
  model: z.literal("ifs_ens_0p25"),
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: pointCoordinateSchema,
  gridPoint: pointCoordinateSchema,
  cadence: z.literal("ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z"),
  selection: z.object({
    diagnostic: ifsEnsDiagnosticTimeSeriesSelectionSchema,
    members: z.array(ifsEnsMemberSchema).min(2),
    quantiles: z.array(z.number().min(0).max(1)).min(1),
  }),
  parcelMethodology: ifsEnsParcelDiagnosticsResultSchema.shape.methodology.optional(),
  series: z.array(ifsEnsDiagnosticTimeSeriesStepSchema).min(1).max(IFS_ENS_MAX_NATIVE_STEPS),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_enfo_ef"),
    horizontalGridDegrees: z.literal(0.25),
    allCacheHit: z.boolean(),
    memberSemantics: z.literal("50_perturbed_members_control_is_oper_fc"),
  }),
}).superRefine((value, context) => {
  for (const [index, step] of value.series.entries()) {
    if (step.kind !== value.selection.diagnostic.kind) {
      context.addIssue({
        code: "custom",
        path: ["series", index, "kind"],
        message: `IFS ENS diagnostic time-series step kind ${step.kind} does not match selection kind ${value.selection.diagnostic.kind}`,
      });
    }
  }
  if (value.selection.diagnostic.kind === "parcel" && value.parcelMethodology === undefined) {
    context.addIssue({
      code: "custom",
      path: ["parcelMethodology"],
      message: "IFS ENS parcel time series must expose parcel methodology once at the root",
    });
  }
  if (value.selection.diagnostic.kind !== "parcel" && value.parcelMethodology !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["parcelMethodology"],
      message: "parcelMethodology is only valid for IFS ENS parcel time series",
    });
  }
});

export type IfsEnsDiagnosticTimeSeriesSelection = z.output<typeof ifsEnsDiagnosticTimeSeriesSelectionSchema>;
export type IfsEnsDiagnosticTimeSeriesQueryInput = z.input<typeof ifsEnsDiagnosticTimeSeriesQuerySchema>;
export type IfsEnsDiagnosticTimeSeriesResult = z.infer<typeof ifsEnsDiagnosticTimeSeriesResultSchema>;
