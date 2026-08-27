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
