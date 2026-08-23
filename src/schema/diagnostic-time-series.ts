import * as z from "zod/v4";
import {
  DEFAULT_TIME_SERIES_MAX_STEPS,
  GFS_TOTAL_NATIVE_FORECAST_STEPS,
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  parcelDefinitionIdSchema,
  pointCoordinateSchema,
  pressureLevelSchema,
  profileDiagnosticIdSchema,
  profileSourceIdSchema,
  runSelectorSchema,
} from "./query.js";

export const diagnosticTimeSeriesSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("layer"),
    lowerPressureHpa: pressureLevelSchema.describe("Lower-altitude pressure surface"),
    upperPressureHpa: pressureLevelSchema.describe("Upper-altitude pressure surface"),
    diagnostics: z.array(layerDiagnosticIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("profile"),
    pressureLevelsHpa: z.array(pressureLevelSchema).min(2),
    diagnostics: z.array(profileDiagnosticIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("parcel"),
    pressureLevelsHpa: z.array(pressureLevelSchema).min(2),
    parcel: parcelDefinitionIdSchema,
  }),
]);

const pointShape = pointCoordinateSchema.shape;

export const diagnosticTimeSeriesQuerySchema = z.object({
  ...pointShape,
  run: runSelectorSchema,
  startTime: isoDateTimeSchema.describe("Inclusive start of requested valid-time range"),
  endTime: isoDateTimeSchema.describe("Inclusive end of requested valid-time range"),
  diagnostic: diagnosticTimeSeriesSelectionSchema,
  source: profileSourceIdSchema.default("s3").describe("S3 is the default for multi-time diagnostic access; NOMADS remains available explicitly"),
  maxSteps: z.number().int().min(1).max(GFS_TOTAL_NATIVE_FORECAST_STEPS).default(DEFAULT_TIME_SERIES_MAX_STEPS),
}).superRefine((query, context) => {
  if (new Date(query.endTime).getTime() < new Date(query.startTime).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "endTime must be at or after startTime",
    });
  }

  switch (query.diagnostic.kind) {
    case "layer":
      if (query.diagnostic.lowerPressureHpa <= query.diagnostic.upperPressureHpa) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "upperPressureHpa"],
          message: "lowerPressureHpa must be greater than upperPressureHpa so the layer is ordered from lower to upper altitude",
        });
      }
      break;
    case "profile":
      if (new Set(query.diagnostic.pressureLevelsHpa).size < 2) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "pressureLevelsHpa"],
          message: "Whole-profile diagnostic time series require at least two distinct pressure levels",
        });
      }
      break;
    case "parcel":
      if (new Set(query.diagnostic.pressureLevelsHpa).size < 2) {
        context.addIssue({
          code: "custom",
          path: ["diagnostic", "pressureLevelsHpa"],
          message: "Parcel diagnostic time series require at least two distinct pressure levels",
        });
      }
      break;
  }
});

export type DiagnosticTimeSeriesSelection = z.output<typeof diagnosticTimeSeriesSelectionSchema>;
export type DiagnosticTimeSeriesQuery = z.output<typeof diagnosticTimeSeriesQuerySchema>;
export type DiagnosticTimeSeriesQueryInput = z.input<typeof diagnosticTimeSeriesQuerySchema>;
