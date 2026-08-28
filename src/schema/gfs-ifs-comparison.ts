import * as z from "zod/v4";
import { ifsPressureLevelSchema, ifsPressureVariableSchema } from "./ifs.js";
import { gfsGridSchema, operationalGfsModelIdSchema } from "./gfs-grid.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";

export const gfsIfsComparisonRunSelectorSchema = z.union([
  z.literal("latest"),
  isoDateTimeSchema,
]).default("latest").describe(
  "Shared GFS/IFS initialization time; 'latest' selects the newest six-hour cycle for which both models can satisfy the requested valid time and pressure selection",
);

export const gfsIfsComparisonQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  gfsGrid: gfsGridSchema.optional(),
  run: gfsIfsComparisonRunSelectorSchema,
  validTime: isoDateTimeSchema,
  variable: ifsPressureVariableSchema.describe(
    "Canonical pressure-level variable supported by both deterministic GFS and ECMWF IFS",
  ),
  pressureLevelHpa: ifsPressureLevelSchema.describe(
    "Pressure level published by both deterministic GFS and ECMWF IFS",
  ),
});

const outputValueSchema = z.object({
  field: z.string().min(1),
  unit: z.string().min(1),
  value: z.number(),
});

export const gfsIfsComparisonResultSchema = z.object({
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number().int().min(0).max(360),
  requestedPoint: pointCoordinateSchema,
  selection: z.object({
    variable: ifsPressureVariableSchema,
    pressureLevelHpa: ifsPressureLevelSchema,
    outputs: z.array(z.object({
      field: z.string().min(1),
      unit: z.string().min(1),
    })).min(1),
  }),
  gfs: z.object({
    model: operationalGfsModelIdSchema,
    gridPoint: pointCoordinateSchema,
    values: z.array(outputValueSchema).min(1),
    source: z.object({
      provider: z.literal("NOAA AWS Open Data"),
      access: z.literal("s3_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      cacheHit: z.boolean(),
    }),
  }),
  ifs: z.object({
    model: z.literal("ifs_0p25"),
    gridPoint: pointCoordinateSchema,
    values: z.array(outputValueSchema).min(1),
    source: z.object({
      provider: z.literal("ECMWF Open Data"),
      access: z.literal("indexed_http_range"),
      decoder: z.enum(["gribberish", "wgrib2"]),
      product: z.literal("ifs_0p25_oper_fc"),
      horizontalGridDegrees: z.literal(0.25),
      cacheHit: z.boolean(),
    }),
  }),
  comparison: z.object({
    outputs: z.array(z.object({
      field: z.string().min(1),
      unit: z.string().min(1),
      gfsValue: z.number(),
      ifsValue: z.number(),
      ifsMinusGfs: z.number(),
      deltaKind: z.enum(["linear", "circular_degrees"]),
    })).min(1),
    interpretation: z.literal("raw_deterministic_model_difference_not_error_or_uncertainty"),
  }),
});

export type GfsIfsComparisonQueryInput = z.input<typeof gfsIfsComparisonQuerySchema>;
export type GfsIfsComparisonResult = z.infer<typeof gfsIfsComparisonResultSchema>;
