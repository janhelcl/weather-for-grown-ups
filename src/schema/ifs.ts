import * as z from "zod/v4";
import {
  IFS_FIELD_IDS,
  IFS_PRESSURE_VARIABLE_IDS,
  isIfsPressureLevel,
} from "../catalog/ifs.js";
import {
  fieldTemporalResultSchema,
  gridPointSchema,
  nonIsobaricFieldLevelResultSchema,
  profileLevelResultSchema,
} from "./result.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const ifsPressureVariableSchema = z.enum(IFS_PRESSURE_VARIABLE_IDS);
export const ifsFieldSchema = z.enum(IFS_FIELD_IDS);
export const ifsPressureLevelSchema = z.number().refine(
  isIfsPressureLevel,
  "Pressure level is not published by the ECMWF IFS 0.25° Open Data product",
);
export const ifsRunSelectorSchema = z.union([
  z.literal("latest"),
  isoDateTimeSchema,
]).default("latest").describe(
  "IFS initialization: latest selection-capable 00/06/12/18Z cycle or an explicit ISO cycle",
);

export const ifsPointQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  run: ifsRunSelectorSchema,
  validTime: isoDateTimeSchema,
  variables: z.array(ifsPressureVariableSchema).min(1).optional(),
  pressureLevelsHpa: z.array(ifsPressureLevelSchema).min(1).optional(),
  fields: z.array(ifsFieldSchema).min(1).optional(),
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
  if (
    query.pressureLevelsHpa !== undefined
    && new Set(query.pressureLevelsHpa).size !== query.pressureLevelsHpa.length
  ) {
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

export const ifsFieldResultSchema = z.object({
  id: ifsFieldSchema,
  level: nonIsobaricFieldLevelResultSchema,
  temporal: fieldTemporalResultSchema,
  values: z.record(z.string(), z.number()),
});

export const ifsProfileResultSchema = z.object({
  model: z.literal("ifs_0p25"),
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(240),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(ifsFieldResultSchema).optional(),
  source: z.object({
    provider: z.literal("ECMWF Open Data"),
    access: z.literal("indexed_http_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    product: z.literal("ifs_0p25_oper_fc"),
    horizontalGridDegrees: z.literal(0.25),
    cacheHit: z.boolean(),
  }),
});

export type IfsPointQuery = z.output<typeof ifsPointQuerySchema>;
export type IfsPointQueryInput = z.input<typeof ifsPointQuerySchema>;
export type IfsProfileResult = z.infer<typeof ifsProfileResultSchema>;
