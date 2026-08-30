import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  isoDateTimeSchema,
  pointCoordinateSchema,
  nonIsobaricFieldIdSchema,
  pressureLevelSchema,
  runSelectorSchema,
  variableIdSchema,
} from "./query.js";

export const DEFAULT_TRANSECT_SAMPLES = 21;
export const MAX_TRANSECT_SAMPLES = 50;

export const transectQuerySchema = z.object({
  start: pointCoordinateSchema.describe("Transect start coordinate"),
  end: pointCoordinateSchema.describe("Transect end coordinate"),
  run: runSelectorSchema,
  grid: gfsGridSchema.optional(),
  validTime: isoDateTimeSchema.describe("Forecast valid time shared by all transect samples"),
  variables: z.array(variableIdSchema).min(1).optional().describe("Pressure-level variables or deterministic derived variables"),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional().describe("Published GFS pressure surfaces included at every transect sample"),
  fields: z.array(nonIsobaricFieldIdSchema).min(1).optional().describe("Non-isobaric fields sampled at every transect point"),
  samples: z.number().int().min(2).max(MAX_TRANSECT_SAMPLES).default(DEFAULT_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
  const hasVariables = query.variables !== undefined;
  const hasPressureLevels = query.pressureLevelsHpa !== undefined;
  const hasFields = query.fields !== undefined;
  if (hasVariables !== hasPressureLevels) {
    context.addIssue({
      code: "custom",
      path: hasVariables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Pressure-level variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (!hasVariables && !hasFields) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one pressure-level variable or non-isobaric field",
    });
  }
  if (query.start.latitude === query.end.latitude && query.start.longitude === query.end.longitude) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "Transect start and end coordinates must differ",
    });
  }
});

export type TransectQuery = z.output<typeof transectQuerySchema>;
export type TransectQueryInput = z.input<typeof transectQuerySchema>;
