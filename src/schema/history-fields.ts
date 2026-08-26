import * as z from "zod/v4";
import { historicalAnalysisTimeSchema, historicalGfsVariableIdSchema } from "./history.js";
import { nonIsobaricFieldResultSchema, gridPointSchema, profileLevelResultSchema } from "./result.js";
import { pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const HISTORICAL_GFS_FIELD_IDS = [
  "surface_pressure",
  "surface_geopotential_height",
  "surface_temperature",
  "surface_cape",
  "surface_cin",
  "temperature_2m",
  "relative_humidity_2m",
  "specific_humidity_2m",
  "dew_point_2m",
  "u_wind_10m",
  "v_wind_10m",
  "wind_10m",
  "temperature_80m",
  "specific_humidity_80m",
  "pressure_80m",
  "u_wind_80m",
  "v_wind_80m",
  "wind_80m",
  "temperature_100m",
  "u_wind_100m",
  "v_wind_100m",
  "wind_100m",
  "precipitable_water",
  "total_column_cloud_water",
  "column_relative_humidity",
  "total_column_ozone",
] as const;

export const historicalGfsFieldIdSchema = z.enum(HISTORICAL_GFS_FIELD_IDS);

export const historicalFieldsQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema,
  variables: z.array(historicalGfsVariableIdSchema).min(1).optional(),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1).optional(),
  fields: z.array(historicalGfsFieldIdSchema).min(1),
}).superRefine((query, context) => {
  if ((query.variables !== undefined) !== (query.pressureLevelsHpa !== undefined)) {
    context.addIssue({
      code: "custom",
      path: query.variables ? ["pressureLevelsHpa"] : ["variables"],
      message: "Historical pressure variables and pressureLevelsHpa must be supplied together",
    });
  }
});

const sourceSchema = z.object({
  provider: z.literal("NOAA NCEI"),
  access: z.literal("ncei_thredds_ncss"),
  dataset: z.string().min(1),
  cacheHit: z.boolean(),
});

export const historicalFieldsResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).optional(),
    pressureLevelsHpa: z.array(z.number().positive()).optional(),
    fields: z.array(historicalGfsFieldIdSchema).min(1),
  }),
  levels: z.array(profileLevelResultSchema).optional(),
  fields: z.array(nonIsobaricFieldResultSchema).min(1),
  source: sourceSchema,
  caveat: z.literal("GFS model analysis fields; not direct observations or homogeneous climatological reanalysis"),
});

export type HistoricalGfsFieldId = z.infer<typeof historicalGfsFieldIdSchema>;
export type HistoricalFieldsQueryInput = z.input<typeof historicalFieldsQuerySchema>;
export type HistoricalFieldsResult = z.infer<typeof historicalFieldsResultSchema>;
