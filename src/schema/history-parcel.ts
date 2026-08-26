import * as z from "zod/v4";
import {
  DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS,
  HISTORICAL_GFS_CYCLE_HOURS_UTC,
  MAX_HISTORICAL_TIME_SERIES_MAX_STEPS,
  historicalAnalysisTimeSchema,
  historicalCycleHourUtcSchema,
} from "./history.js";
import {
  gridPointSchema,
  parcelComputationSchema,
  profileLevelResultSchema,
} from "./result.js";
import {
  isoDateTimeSchema,
  parcelDefinitionIdSchema,
  pointCoordinateSchema,
  pressureLevelSchema,
} from "./query.js";

const historicalParcelCaveatSchema = z.literal(
  "Parcel diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis",
);

const historicalParcelSelectionShape = {
  pressureLevelsHpa: z.array(z.number().positive()).min(2),
  parcel: parcelDefinitionIdSchema,
};

export const historicalParcelQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema,
  pressureLevelsHpa: z.array(pressureLevelSchema).min(2).describe(
    "Published pressure surfaces forming the explicit historical environmental sounding used for parcel ascent and CAPE/CIN integration",
  ),
  parcel: parcelDefinitionIdSchema.describe("Explicit parcel initialization method"),
}).superRefine((query, context) => {
  if (new Set(query.pressureLevelsHpa).size < 2) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "Historical parcel diagnostics require at least two distinct pressure levels",
    });
  }
});

const historicalParcelSourceSchema = z.object({
  provider: z.literal("NOAA NCEI"),
  access: z.literal("ncei_thredds_ncss"),
  dataset: z.string().min(1),
  cacheHit: z.boolean(),
});

export const historicalParcelResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object(historicalParcelSelectionShape),
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  parcel: parcelComputationSchema,
  source: historicalParcelSourceSchema,
  caveat: historicalParcelCaveatSchema,
});

export const historicalParcelTimeSeriesQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  startTime: isoDateTimeSchema.describe("Inclusive start of historical analysis range"),
  endTime: isoDateTimeSchema.describe("Inclusive end of historical analysis range"),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(2),
  parcel: parcelDefinitionIdSchema,
  cycleHoursUtc: z.array(historicalCycleHourUtcSchema)
    .min(1)
    .max(HISTORICAL_GFS_CYCLE_HOURS_UTC.length)
    .default([...HISTORICAL_GFS_CYCLE_HOURS_UTC]),
  maxSteps: z.number().int().min(1).max(MAX_HISTORICAL_TIME_SERIES_MAX_STEPS)
    .default(DEFAULT_HISTORICAL_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.startTime) > new Date(query.endTime)) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be greater than or equal to startTime",
    });
  }
  if (new Set(query.pressureLevelsHpa).size < 2) {
    context.addIssue({
      code: "custom",
      path: ["pressureLevelsHpa"],
      message: "Historical parcel diagnostics require at least two distinct pressure levels",
    });
  }
  if (new Set(query.cycleHoursUtc).size !== query.cycleHoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["cycleHoursUtc"],
      message: "cycleHoursUtc must not contain duplicates",
    });
  }
});

export const historicalParcelTimeSeriesResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  requestedStartTime: z.string().datetime({ offset: true }),
  requestedEndTime: z.string().datetime({ offset: true }),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    ...historicalParcelSelectionShape,
    cycleHoursUtc: z.array(historicalCycleHourUtcSchema).min(1),
  }),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
  }),
  series: z.array(z.object({
    analysisTime: historicalAnalysisTimeSchema,
    levels: z.array(profileLevelResultSchema).min(2),
    parcel: parcelComputationSchema,
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  })).min(1),
  caveat: historicalParcelCaveatSchema,
});

export type HistoricalParcelQueryInput = z.input<typeof historicalParcelQuerySchema>;
export type HistoricalParcelResult = z.infer<typeof historicalParcelResultSchema>;
export type HistoricalParcelTimeSeriesQueryInput = z.input<typeof historicalParcelTimeSeriesQuerySchema>;
export type HistoricalParcelTimeSeriesResult = z.infer<typeof historicalParcelTimeSeriesResultSchema>;
