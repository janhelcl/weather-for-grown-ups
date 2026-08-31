import * as z from "zod/v4";
import {
  AIGFS_PRESSURE_VARIABLE_IDS,
  isAigfsPressureLevel,
  isAigfsPressureVariable,
} from "../catalog/aigfs.js";
import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { AIFS_ENS_MEMBERS } from "../catalog/aifs-ens.js";
import {
  isAifsPressureVariable,
  isSupportedAifsPressureSelection,
} from "../catalog/aifs.js";
import {
  GEFS_MEMBERS,
  isSupportedGefsProfileSelection,
} from "../catalog/gefs.js";
import {
  HGEFS_MEMBERS,
  isHgefsMember,
  splitHgefsMembers,
} from "../catalog/hgefs.js";
import { gefsMemberSchema } from "./gefs-ensemble.js";
import { gfsGridSchema } from "./gfs-grid.js";
import { ifsEnsMemberSchema } from "./ifs-ens.js";
import {
  ifsPressureLevelSchema,
  ifsPressureVariableSchema,
} from "./ifs.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import { atmosphericRunSelectorSchema, publicDatasetCapabilities } from "./unified-api.js";

const runSchema = atmosphericRunSelectorSchema;
const quantilesSchema = z.array(z.number().min(0).max(1))
  .min(1)
  .max(9)
  .default([0.1, 0.5, 0.9]);

const pointBase = {
  geometry: z.object({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.object({ at: isoDateTimeSchema }),
  variable: z.string().min(1),
  pressureLevelHpa: z.number().positive(),
  run: runSchema,
};

const aigefsMemberSchema = z.enum(AIGEFS_MEMBERS);
const aifsEnsMemberSchema = z.enum(AIFS_ENS_MEMBERS);
const hgefsMemberSchema = z.string().refine(isHgefsMember, "Unknown HGEFS member");

export const compareGfsAigfsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("gfs"), z.literal("aigfs")]),
  ...pointBase,
  gfsGrid: gfsGridSchema.optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  quantiles: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateAigfsSelection(request.variable, request.pressureLevelHpa, context);
});

export const compareIfsAifsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("ifs"), z.literal("aifs")]),
  ...pointBase,
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  quantiles: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateIfsSelection(request.variable, request.pressureLevelHpa, context);
  validateAifsSelection(request.variable, request.pressureLevelHpa, context);
});

export const compareAigfsAifsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("aigfs"), z.literal("aifs")]),
  ...pointBase,
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
  quantiles: z.never().optional(),
  thresholdGte: z.never().optional(),
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateAigfsSelection(request.variable, request.pressureLevelHpa, context);
  validateAifsSelection(request.variable, request.pressureLevelHpa, context);
});

export const compareGefsAigefsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("gefs"), z.literal("aigefs")]),
  ...pointBase,
  gefsMembers: z.array(gefsMemberSchema).min(2).max(GEFS_MEMBERS.length)
    .default([...GEFS_MEMBERS]),
  aigefsMembers: z.array(aigefsMemberSchema).min(2).max(AIGEFS_MEMBERS.length)
    .default([...AIGEFS_MEMBERS]),
  quantiles: quantilesSchema,
  thresholdGte: z.number().optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateAigfsSelection(request.variable, request.pressureLevelHpa, context);
  if (!isSupportedGefsProfileSelection(request.variable as never, request.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS cannot satisfy ${request.variable} at ${request.pressureLevelHpa} hPa for GEFS/AIGEFS comparison`,
    });
  }
  validateUnique(request.gefsMembers, ["gefsMembers"], "GEFS member selection", context);
  validateUnique(request.aigefsMembers, ["aigefsMembers"], "AIGEFS member selection", context);
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
  validateScalarVariable(request.variable, context);
});

export const compareIfsEnsAifsEnsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("ifs-ens"), z.literal("aifs-ens")]),
  ...pointBase,
  ifsEnsMembers: z.array(ifsEnsMemberSchema).min(2).optional(),
  aifsEnsMembers: z.array(aifsEnsMemberSchema).min(2).max(AIFS_ENS_MEMBERS.length)
    .default([...AIFS_ENS_MEMBERS]),
  quantiles: quantilesSchema,
  thresholdGte: z.number().optional(),
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  hgefsMembers: z.never().optional(),
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateIfsSelection(request.variable, request.pressureLevelHpa, context);
  validateAifsSelection(request.variable, request.pressureLevelHpa, context);
  if (request.ifsEnsMembers) {
    validateUnique(request.ifsEnsMembers, ["ifsEnsMembers"], "IFS ENS member selection", context);
  }
  validateUnique(request.aifsEnsMembers, ["aifsEnsMembers"], "AIFS ENS member selection", context);
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
  validateScalarVariable(request.variable, context);
});

const hybridBase = {
  ...pointBase,
  gfsGrid: z.never().optional(),
  members: z.never().optional(),
  gefsMembers: z.never().optional(),
  aigefsMembers: z.never().optional(),
  ifsEnsMembers: z.never().optional(),
  aifsEnsMembers: z.never().optional(),
  hgefsMembers: z.array(hgefsMemberSchema).min(4).max(HGEFS_MEMBERS.length)
    .default([...HGEFS_MEMBERS]),
  quantiles: quantilesSchema,
  thresholdGte: z.number().optional(),
};

export const compareHgefsGefsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("hgefs"), z.literal("gefs")]),
  ...hybridBase,
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateAigfsSelection(request.variable, request.pressureLevelHpa, context);
  if (!isSupportedGefsProfileSelection(request.variable as never, request.pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `GEFS cannot satisfy ${request.variable} at ${request.pressureLevelHpa} hPa for HGEFS constituent comparison`,
    });
  }
  validateHybridMembers(request.hgefsMembers as any, "gefs", context);
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
  validateScalarVariable(request.variable, context);
});

export const compareHgefsAigefsDatasetsSchema = z.object({
  datasets: z.tuple([z.literal("hgefs"), z.literal("aigefs")]),
  ...hybridBase,
}).superRefine((request, context) => {
  validateRun(request.run, request.datasets, context);
  validateAigfsSelection(request.variable, request.pressureLevelHpa, context);
  validateHybridMembers(request.hgefsMembers as any, "aigefs", context);
  validateUnique(request.quantiles, ["quantiles"], "Quantile selection", context);
  validateScalarVariable(request.variable, context);
});

function validateRun(
  run: string,
  datasets: readonly ("gfs" | "aigfs" | "aigefs" | "hgefs" | "gefs" | "ifs" | "aifs" | "aifs-ens" | "ifs-ens")[],
  context: z.RefinementCtx,
): void {
  const selector = run === "latest" || run === "latest_complete" ? run : "explicit";
  const unsupported = datasets.filter(
    (dataset) => !publicDatasetCapabilities(dataset).runSelectors.includes(selector),
  );
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["run"],
      message: `run=${run} is not supported by dataset(s): ${unsupported.join(", ")}`,
    });
  }
}

function validateAigfsSelection(
  variable: string,
  pressureLevelHpa: number,
  context: z.RefinementCtx,
): void {
  if (!isAigfsPressureVariable(variable)) {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: `AIGFS comparison variables are: ${AIGFS_PRESSURE_VARIABLE_IDS.join(", ")}`,
    });
  }
  if (!isAigfsPressureLevel(pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `AIGFS does not publish ${pressureLevelHpa} hPa`,
    });
  }
}

function validateAifsSelection(
  variable: string,
  pressureLevelHpa: number,
  context: z.RefinementCtx,
): void {
  if (!isAifsPressureVariable(variable)) {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: `AIFS does not support comparison variable ${variable}`,
    });
    return;
  }
  if (!isSupportedAifsPressureSelection(variable, pressureLevelHpa)) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `AIFS cannot satisfy ${variable} at ${pressureLevelHpa} hPa`,
    });
  }
}

function validateIfsSelection(
  variable: string,
  pressureLevelHpa: number,
  context: z.RefinementCtx,
): void {
  if (!ifsPressureVariableSchema.safeParse(variable).success) {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: `IFS does not support comparison variable ${variable}`,
    });
  }
  if (!ifsPressureLevelSchema.safeParse(pressureLevelHpa).success) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelHpa"],
      message: `IFS does not publish ${pressureLevelHpa} hPa in the comparison contract`,
    });
  }
}

function validateScalarVariable(variable: string, context: z.RefinementCtx): void {
  if (variable === "wind") {
    context.addIssue({
      code: "custom",
      path: ["variable"],
      message: "Cross-ensemble comparison currently requires one scalar output; compare u_wind or v_wind rather than vector wind",
    });
  }
}

function validateHybridMembers(
  members: readonly string[],
  constituent: "gefs" | "aigefs",
  context: z.RefinementCtx,
): void {
  validateUnique(members, ["hgefsMembers"], "HGEFS member selection", context);
  const split = splitHgefsMembers(members as any);
  if (split.gefs.length < 2 || split.aigefs.length < 2) {
    context.addIssue({
      code: "custom",
      path: ["hgefsMembers"],
      message: "HGEFS comparison requires at least two selected GEFS and two selected AIGEFS members so the hybrid remains a genuine two-population distribution",
    });
  }
  const selected = constituent === "gefs" ? split.gefs.length : split.aigefs.length;
  if (selected < 2) {
    context.addIssue({
      code: "custom",
      path: ["hgefsMembers"],
      message: `HGEFS/${constituent.toUpperCase()} comparison requires at least two ${constituent.toUpperCase()} constituent members`,
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

export const MODEL_CLASS_COMPARISON_PAIRS = [
  ["gfs", "aigfs"],
  ["ifs", "aifs"],
  ["aigfs", "aifs"],
  ["gefs", "aigefs"],
  ["ifs-ens", "aifs-ens"],
  ["hgefs", "gefs"],
  ["hgefs", "aigefs"],
] as const;
