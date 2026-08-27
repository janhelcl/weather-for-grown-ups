import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  isoDateTimeSchema,
  pointCoordinateSchema,
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
  grid: gfsGridSchema,
  validTime: isoDateTimeSchema.describe("Forecast valid time shared by all transect samples"),
  variables: z.array(variableIdSchema).min(1).describe("Pressure-level variables or deterministic derived variables"),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).describe("Published GFS pressure surfaces included at every transect sample"),
  samples: z.number().int().min(2).max(MAX_TRANSECT_SAMPLES).default(DEFAULT_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
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
