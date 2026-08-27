import * as z from "zod/v4";

export const MAX_ARCHIVED_GFS_FORECAST_HOUR = 192;

export const archivedGfsForecastHourSchema = z.number()
  .int()
  .min(0)
  .max(MAX_ARCHIVED_GFS_FORECAST_HOUR)
  .refine(
    (value) => value % 3 === 0,
    "Archived GFS Grid 4 forecastHour must be a multiple of 3 hours",
  );

export const MAX_ARCHIVED_GFS_0P25_FORECAST_HOUR = 384;

export const archivedGfs025ForecastHourSchema = z.number()
  .int()
  .min(0)
  .max(MAX_ARCHIVED_GFS_0P25_FORECAST_HOUR)
  .refine(
    (value) => value <= 240
      ? value % 3 === 0
      : value >= 252 && value % 12 === 0,
    "Archived GFS 0.25 forecastHour must use native 3-hour output through +240h and 12-hour output from +252h",
  );
