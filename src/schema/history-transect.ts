import * as z from "zod/v4";
import { historicalGfsFieldIdSchema } from "./history-fields.js";
import { historicalAnalysisTimeSchema, historicalGfsVariableIdSchema } from "./history.js";
import { historicalPointResultSchema, MAX_HISTORICAL_POINTS } from "./history-points.js";
import { pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const DEFAULT_HISTORICAL_TRANSECT_SAMPLES = 10;
export const MAX_HISTORICAL_TRANSECT_SAMPLES = MAX_HISTORICAL_POINTS;

export const historicalTransectQuerySchema = z.object({
  start: pointCoordinateSchema,
  end: pointCoordinateSchema,
  analysisTime: historicalAnalysisTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(historicalGfsFieldIdSchema).min(1).optional(),
  samples: z.number().int().min(2).max(MAX_HISTORICAL_TRANSECT_SAMPLES)
    .default(DEFAULT_HISTORICAL_TRANSECT_SAMPLES),
}).superRefine((query, context) => {
  if (query.start.latitude === query.end.latitude && query.start.longitude === query.end.longitude) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "Transect start and end coordinates must differ",
    });
  }
  if ((query.variables !== undefined) !== (query.pressureLevelsHpa !== undefined)) {
    context.addIssue({
      code: "custom",
      path: query.variables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Historical pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
  if (query.variables === undefined && query.fields === undefined) {
    context.addIssue({
      code: "custom",
      path: ["fields"],
      message: "Request at least one historical pressure variable or non-isobaric field",
    });
  }
});

export const historicalTransectSampleSchema = historicalPointResultSchema.extend({
  index: z.number().int().nonnegative(),
  fraction: z.number().min(0).max(1),
  distanceKm: z.number().nonnegative(),
});

export const historicalTransectResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  startPoint: pointCoordinateSchema,
  endPoint: pointCoordinateSchema,
  totalDistanceKm: z.number().nonnegative(),
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).optional(),
    pressureLevelsHpa: z.array(z.number().positive()).optional(),
    fields: z.array(historicalGfsFieldIdSchema).optional(),
  }),
  samples: z.array(historicalTransectSampleSchema).min(2),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    composition: z.literal("great_circle_to_serial_point_queries"),
  }),
  caveat: z.literal(
    "GFS model analysis; not direct observations or homogeneous climatological reanalysis",
  ),
});

export type HistoricalTransectQueryInput = z.input<typeof historicalTransectQuerySchema>;
export type HistoricalTransectResult = z.infer<typeof historicalTransectResultSchema>;
