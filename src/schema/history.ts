import * as z from "zod/v4";
import { pressureLevelSchema, pointCoordinateSchema } from "./query.js";

export const HISTORICAL_GFS_VARIABLE_IDS = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
  "vertical_velocity",
  "absolute_vorticity",
  "wind",
  "dew_point",
  "potential_temperature",
] as const;

export const historicalGfsVariableIdSchema = z.enum(HISTORICAL_GFS_VARIABLE_IDS);

export const historicalAnalysisTimeSchema = z.string().refine((value) => {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(value);
  return date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
    && [0, 6, 12, 18].includes(date.getUTCHours());
}, "Expected an exact GFS analysis cycle at 00, 06, 12, or 18 UTC");

export const historicalProfileQuerySchema = z.object({
  ...pointCoordinateSchema.shape,
  analysisTime: historicalAnalysisTimeSchema.describe(
    "Historical GFS Grid 4 analysis cycle. The online NCEI archive begins in 2007; this is model analysis, not an observation or homogeneous climatological reanalysis.",
  ),
  variables: z.array(historicalGfsVariableIdSchema).min(1),
  pressureLevelsHpa: z.array(pressureLevelSchema).min(1),
});

export type HistoricalGfsVariableId = z.infer<typeof historicalGfsVariableIdSchema>;
export type HistoricalProfileQuery = z.output<typeof historicalProfileQuerySchema>;
export type HistoricalProfileQueryInput = z.input<typeof historicalProfileQuerySchema>;
