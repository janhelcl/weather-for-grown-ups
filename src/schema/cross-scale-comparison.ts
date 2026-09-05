import * as z from "zod/v4";
import { ICON_D2_EPS_MEMBERS } from "../catalog/icon-d2-eps.js";
import {
  ICON_D2_PRESSURE_LEVELS_HPA,
  ICON_D2_PRESSURE_VARIABLE_IDS,
} from "../catalog/icon-d2.js";
import { PE_AROME_MEMBERS } from "../catalog/pe-arome.js";
import { gfsGridSchema } from "./gfs-grid.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const IFS_ICON_D2_PRESSURE_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "wind",
  "dew_point",
  "potential_temperature",
] as const;

export const IFS_ICON_D2_PRESSURE_LEVELS_HPA = [
  300, 400, 500, 600, 700, 850, 925, 1000,
] as const;

export const GFS_ICON_D2_PRESSURE_VARIABLES = [
  ...ICON_D2_PRESSURE_VARIABLE_IDS,
] as const;

export const GFS_ICON_D2_PRESSURE_LEVELS_HPA = [
  ...ICON_D2_PRESSURE_LEVELS_HPA,
] as const;

export const IFS_ICON_D2_FIELDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
] as const;

export const GFS_ICON_D2_FIELDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "mean_sea_level_pressure",
] as const;

export const IFS_AROME_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "u_wind_100m",
  "v_wind_100m",
  "wind_100m",
] as const;

export const IFS_ENS_ICON_D2_EPS_PRESSURE_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "dew_point",
  "potential_temperature",
] as const;

export const IFS_ENS_ICON_D2_EPS_FIELDS = [
  "temperature_2m",
  "u_wind_10m",
  "v_wind_10m",
] as const;

export const IFS_ENS_PE_AROME_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
] as const;

const pointGeometrySchema = z.object({
  type: z.literal("point"),
  ...pointCoordinateSchema.shape,
});
const pointTimeSchema = z.object({ at: isoDateTimeSchema });
const explicitSharedRunSchema = isoDateTimeSchema.describe(
  "Explicit initialization shared by both datasets. Cross-scale comparison intentionally does not resolve provider-specific latest cycles independently.",
);
const quantilesSchema = z.array(z.number().min(0).max(1))
  .min(1)
  .max(9)
  .default([0.1, 0.5, 0.9]);

const deterministicForbiddenControls = {
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  iconD2EpsMembers: z.never().optional(),
  peAromeMembers: z.never().optional(),
  quantiles: z.never().optional(),
  thresholdGte: z.never().optional(),
};

const ensembleForbiddenControls = {
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  gfsGrid: z.never().optional(),
};

const ifsIconPressureLevelSchema = z.number().refine(
  (value) => (IFS_ICON_D2_PRESSURE_LEVELS_HPA as readonly number[]).includes(value),
  `IFS/ICON-D2 comparison pressure levels are: ${IFS_ICON_D2_PRESSURE_LEVELS_HPA.join(", ")} hPa`,
);
const gfsIconPressureLevelSchema = z.number().refine(
  (value) => (GFS_ICON_D2_PRESSURE_LEVELS_HPA as readonly number[]).includes(value),
  `GFS/ICON-D2 comparison pressure levels are: ${GFS_ICON_D2_PRESSURE_LEVELS_HPA.join(", ")} hPa`,
);

export const compareIfsIconD2DatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("ifs"), z.literal("icon-d2")]),
  geometry: pointGeometrySchema,
  time: pointTimeSchema,
  run: explicitSharedRunSchema,
  variable: z.enum(IFS_ICON_D2_PRESSURE_VARIABLES).optional(),
  pressureLevelHpa: ifsIconPressureLevelSchema.optional(),
  field: z.enum(IFS_ICON_D2_FIELDS).optional(),
  gfsGrid: z.never().optional(),
  ...deterministicForbiddenControls,
}).superRefine((request, context) => {
  validateCrossScaleSelection(request, context);
  validateSharedCycleAndLead(request.run, request.time.at, 48, 3, context);
});

export const compareGfsIconD2DatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("gfs"), z.literal("icon-d2")]),
  geometry: pointGeometrySchema,
  time: pointTimeSchema,
  run: explicitSharedRunSchema,
  variable: z.enum(GFS_ICON_D2_PRESSURE_VARIABLES).optional(),
  pressureLevelHpa: gfsIconPressureLevelSchema.optional(),
  field: z.enum(GFS_ICON_D2_FIELDS).optional(),
  gfsGrid: gfsGridSchema.optional(),
  ...deterministicForbiddenControls,
}).superRefine((request, context) => {
  validateCrossScaleSelection(request, context);
  validateSharedCycleAndLead(request.run, request.time.at, 48, 1, context);
});

export const compareIfsAromeDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("ifs"), z.literal("arome")]),
  geometry: pointGeometrySchema,
  time: pointTimeSchema,
  run: explicitSharedRunSchema,
  field: z.enum(IFS_AROME_FIELDS),
  variable: z.never().optional(),
  pressureLevelHpa: z.never().optional(),
  gfsGrid: z.never().optional(),
  ...deterministicForbiddenControls,
}).superRefine((request, context) => {
  validateSharedCycleAndLead(request.run, request.time.at, 51, 3, context);
});

const iconD2EpsMemberSchema = z.enum(ICON_D2_EPS_MEMBERS);
const peAromeMemberSchema = z.enum(PE_AROME_MEMBERS);

export const compareIfsEnsIconD2EpsDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("ifs-ens"), z.literal("icon-d2-eps")]),
  geometry: pointGeometrySchema,
  time: pointTimeSchema,
  run: explicitSharedRunSchema,
  variable: z.enum(IFS_ENS_ICON_D2_EPS_PRESSURE_VARIABLES).optional(),
  pressureLevelHpa: ifsIconPressureLevelSchema.optional(),
  field: z.enum(IFS_ENS_ICON_D2_EPS_FIELDS).optional(),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).optional(),
  iconD2EpsMembers: z.array(iconD2EpsMemberSchema).min(2).max(ICON_D2_EPS_MEMBERS.length)
    .default([...ICON_D2_EPS_MEMBERS]),
  peAromeMembers: z.never().optional(),
  quantiles: quantilesSchema,
  thresholdGte: z.number().optional(),
  ...ensembleForbiddenControls,
}).superRefine((request, context) => {
  validateCrossScaleSelection(request, context);
  validateSharedCycleAndLead(request.run, request.time.at, 48, 3, context);
  if (request.ifsEnsMembers) {
    validateUnique(request.ifsEnsMembers, ["ifsEnsMembers"], "IFS ENS member selection", context);
  }
  validateUnique(
    request.iconD2EpsMembers,
    ["iconD2EpsMembers"],
    "ICON-D2-EPS member selection",
    context,
  );
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
});

export const compareIfsEnsPeAromeDatasetsSchema = z.strictObject({
  datasets: z.tuple([z.literal("ifs-ens"), z.literal("pe-arome")]),
  geometry: pointGeometrySchema,
  time: pointTimeSchema,
  run: explicitSharedRunSchema,
  field: z.enum(IFS_ENS_PE_AROME_FIELDS),
  variable: z.never().optional(),
  pressureLevelHpa: z.never().optional(),
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).optional(),
  iconD2EpsMembers: z.never().optional(),
  peAromeMembers: z.array(peAromeMemberSchema).min(2).max(PE_AROME_MEMBERS.length)
    .default([...PE_AROME_MEMBERS]),
  quantiles: quantilesSchema,
  thresholdGte: z.number().optional(),
  ...ensembleForbiddenControls,
}).superRefine((request, context) => {
  validateSharedCycleAndLead(request.run, request.time.at, 51, 3, context);
  if (request.ifsEnsMembers) {
    validateUnique(request.ifsEnsMembers, ["ifsEnsMembers"], "IFS ENS member selection", context);
  }
  validateUnique(request.peAromeMembers, ["peAromeMembers"], "PE-AROME member selection", context);
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
});

function validateCrossScaleSelection(
  request: {
    variable?: string | undefined;
    pressureLevelHpa?: number | undefined;
    field?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const pressureRequested = request.variable !== undefined || request.pressureLevelHpa !== undefined;
  const fieldRequested = request.field !== undefined;
  if (pressureRequested && fieldRequested) {
    context.addIssue({
      code: "custom",
      path: ["field"],
      message: "Cross-scale comparison accepts one pressure-level variable or one non-isobaric field, not both",
    });
    return;
  }
  if (fieldRequested) return;
  if (request.variable === undefined || request.pressureLevelHpa === undefined) {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: "Cross-scale comparison requires either field or both variable and pressureLevelHpa",
    });
  }
}

function validateSharedCycleAndLead(
  run: string,
  validTime: string,
  maxLeadHours: number,
  cadenceHours: number,
  context: z.RefinementCtx,
): void {
  const runTime = new Date(run);
  const valid = new Date(validTime);
  if (
    runTime.getUTCMinutes() !== 0
    || runTime.getUTCSeconds() !== 0
    || runTime.getUTCMilliseconds() !== 0
    || ![0, 6, 12, 18].includes(runTime.getUTCHours())
  ) {
    context.addIssue({
      code: "custom",
      path: ["run"],
      message: "Cross-scale comparisons require an explicit shared 00/06/12/18Z initialization cycle",
    });
  }

  const leadHours = (valid.getTime() - runTime.getTime()) / 3_600_000;
  if (!Number.isInteger(leadHours) || leadHours < 0 || leadHours > maxLeadHours) {
    context.addIssue({
      code: "custom",
      path: ["time", "at"],
      message: `Cross-scale valid time must be an integer forecast hour from f000 through f${String(maxLeadHours).padStart(3, "0")}`,
    });
    return;
  }
  if (leadHours % cadenceHours !== 0) {
    context.addIssue({
      code: "custom",
      path: ["time", "at"],
      message: `Cross-scale valid time must align to the shared ${cadenceHours}-hour output cadence for this pair`,
    });
  }
}

function validateUnique(
  values: readonly unknown[],
  path: (string | number)[],
  label: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message: `${label} must not contain duplicates` });
  }
}

export const CROSS_SCALE_COMPARISON_PAIRS = [
  ["ifs", "icon-d2"],
  ["ifs", "arome"],
  ["gfs", "icon-d2"],
  ["ifs-ens", "icon-d2-eps"],
  ["ifs-ens", "pe-arome"],
] as const;
