import * as z from "zod/v4";
import { IFS_FIELD_IDS, IFS_PRESSURE_VARIABLE_IDS } from "../catalog/ifs.js";
import {
  ifsFieldResultSchema,
  ifsPressureLevelSchema,
  ifsRunSelectorSchema,
} from "./ifs.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import {
  runComparisonFieldChangeSchema,
  runComparisonPressureLevelChangeSchema,
} from "./run-comparison-result.js";

export const ifsRunComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  anchorRun: ifsRunSelectorSchema.describe(
    "Newest IFS run in the comparison; earlier runs are consecutive six-hour ECMWF cycles",
  ),
  validTime: isoDateTimeSchema,
  variables: z.array(z.enum(IFS_PRESSURE_VARIABLE_IDS)).min(1).optional(),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(1).optional(),
  fields: z.array(z.enum(IFS_FIELD_IDS)).min(1).optional(),
  cycles: z.number().int().min(2).max(6).default(3),
}).superRefine((query, context) => {
  const hasVariables = query.variables !== undefined;
  const hasLevels = query.pressureLevelsHpa !== undefined;
  if (hasVariables !== hasLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "IFS pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && query.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one IFS pressure variable or field",
    });
  }
  if (query.variables !== undefined && new Set(query.variables).size !== query.variables.length) {
    context.addIssue({ code: "custom", path: ["variables"], message: "variables must not contain duplicates" });
  }
  if (query.pressureLevelsHpa !== undefined && new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "pressureLevelsHpa must not contain duplicates",
    });
  }
  if (query.fields !== undefined && new Set(query.fields).size !== query.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "fields must not contain duplicates" });
  }
});

const snapshotSchema = z.object({
  run: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  levels: z.array(profileLevelResultSchema),
  fields: z.array(ifsFieldResultSchema).optional(),
  cacheHit: z.boolean(),
});

const transitionSchema = z.object({
  fromRun: isoDateTimeSchema,
  toRun: isoDateTimeSchema,
  fromForecastHour: z.number().int().min(0).max(240),
  toForecastHour: z.number().int().min(0).max(240),
  pressureLevels: z.array(runComparisonPressureLevelChangeSchema),
  fields: z.array(runComparisonFieldChangeSchema),
});

export const ifsRunComparisonResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  validTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  anchorRun: isoDateTimeSchema,
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_oper_fc"),
    horizontalGridDegrees: z.literal(0.25),
  }),
  runs: z.array(snapshotSchema).min(2).max(6),
  comparisons: z.array(transitionSchema).min(1).max(5),
}).superRefine((value, context) => {
  if (value.comparisons.length !== value.runs.length - 1) {
    context.addIssue({
      code: "custom",
      path: ["comparisons"],
      message: "IFS run comparison must contain one transition between each consecutive pair of runs",
    });
  }
  if (value.runs.at(-1)?.run !== value.anchorRun) {
    context.addIssue({
      code: "custom",
      path: ["anchorRun"],
      message: "anchorRun must equal the newest returned IFS run",
    });
  }
});

export type IfsRunComparisonQueryInput = z.input<typeof ifsRunComparisonQuerySchema>;
export type IfsRunComparisonResult = z.infer<typeof ifsRunComparisonResultSchema>;
