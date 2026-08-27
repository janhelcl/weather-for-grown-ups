import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import { historicalAnalysisTimeSchema } from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";
import { pointCoordinateSchema } from "./query.js";

export const IGRA_VERIFICATION_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "geopotential_height",
  "wind",
  "dew_point",
] as const;

export const igraVerificationVariableSchema = z.enum(IGRA_VERIFICATION_VARIABLE_IDS);
export type IgraVerificationVariable = z.infer<typeof igraVerificationVariableSchema>;

export const igraForecastVerificationQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  validTime: historicalAnalysisTimeSchema.describe(
    "Nominal radiosonde verification time at 00/06/12/18 UTC",
  ),
  leadHours: historicalVerificationLeadHoursSchema,
  variables: z.array(igraVerificationVariableSchema).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).default(250),
  gfsGrid: gfsGridSchema.optional(),
});

export type IgraForecastVerificationQueryInput = z.input<typeof igraForecastVerificationQuerySchema>;
export type IgraForecastVerificationQuery = z.output<typeof igraForecastVerificationQuerySchema>;

const igraStationSchema = z.object({
  id: z.string().length(11),
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  elevationM: z.number().optional(),
  firstYear: z.number().int(),
  lastYear: z.number().int(),
});

const numericObservationChangeSchema = z.object({
  field: z.string().min(1),
  forecast: z.number(),
  observation: z.number(),
  delta: z.number(),
  deltaKind: z.enum(["linear", "circular_degrees"]),
});

export const igraForecastVerificationResultSchema = z.object({
  model: z.literal("gfs_igra_verification"),
  validTime: historicalAnalysisTimeSchema,
  leadHours: historicalVerificationLeadHoursSchema,
  forecastRun: historicalAnalysisTimeSchema,
  gfsGrid: gfsGridSchema,
  requestedPoint: gridPointSchema,
  station: igraStationSchema.extend({
    distanceKm: z.number().nonnegative(),
    soundingLatitude: z.number(),
    soundingLongitude: z.number(),
  }),
  selection: z.object({
    variables: z.array(igraVerificationVariableSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  comparison: z.literal("observation_minus_forecast"),
  forecast: z.object({
    model: z.enum(["gfs_0p25_forecast_archive", "gfs_grid4_forecast_0p5_archive"]),
    runTime: historicalAnalysisTimeSchema,
    forecastHour: historicalVerificationLeadHoursSchema,
    validTime: historicalAnalysisTimeSchema,
    gridPoint: gridPointSchema,
    levels: z.array(profileLevelResultSchema),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  observation: z.object({
    dataset: z.literal("igra_v2_2"),
    nominalTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema),
    sourceFile: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  matchedPressureLevelsHpa: z.array(z.number().positive()),
  missingPressureLevelsHpa: z.array(z.number().positive()),
  pressureLevels: z.array(z.object({
    pressureHpa: z.number().positive(),
    changes: z.array(numericObservationChangeSchema),
  })),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    observationAccess: z.literal("igra_v2_2_station_file"),
    forecastArchiveAccess: z.string().min(1),
  }),
  caveat: z.literal(
    "Radiosonde verification compares a point observation profile with a model grid-cell forecast; no vertical interpolation is performed, and sounding drift/instrument or station changes can affect comparability",
  ),
});

export type IgraForecastVerificationResult = z.infer<typeof igraForecastVerificationResultSchema>;
