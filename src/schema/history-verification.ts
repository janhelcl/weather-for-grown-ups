import * as z from "zod/v4";
import {
  historicalAnalysisTimeSchema,
  historicalGfsVariableIdSchema,
} from "./history.js";
import { pointCoordinateSchema, pressureLevelSchema } from "./query.js";

export const MAX_HISTORICAL_VERIFICATION_LEAD_HOURS = 192;

export const historicalVerificationLeadHoursSchema = z.number()
  .int()
  .min(0)
  .max(MAX_HISTORICAL_VERIFICATION_LEAD_HOURS)
  .refine((value) => value % 6 === 0, "leadHours must be a multiple of 6 hours so the forecast verifies against a native GFS analysis cycle");

export const historicalForecastVerificationQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  validTime: historicalAnalysisTimeSchema.describe(
    "Historical verification time at a native 00/06/12/18 UTC GFS analysis cycle",
  ),
  leadHours: historicalVerificationLeadHoursSchema.describe(
    "Forecast lead in hours. WFG derives the archived forecast run as validTime - leadHours.",
  ),
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
});

export type HistoricalForecastVerificationQuery = z.output<typeof historicalForecastVerificationQuerySchema>;
export type HistoricalForecastVerificationQueryInput = z.input<typeof historicalForecastVerificationQuerySchema>;
