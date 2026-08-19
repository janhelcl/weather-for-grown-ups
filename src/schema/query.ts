import * as z from "zod/v4";

export const variableIdSchema = z.enum([
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "wind",
]);

export const isoDateTimeSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Expected an ISO-8601 date-time",
);

export const profileQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  run: isoDateTimeSchema.describe("GFS model initialization time, UTC"),
  validTime: isoDateTimeSchema.describe("Forecast valid time, UTC"),
  variables: z.array(variableIdSchema).min(1),
  pressureLevelsHpa: z.array(z.number().int().min(1).max(1100)).min(1),
});

export type VariableId = z.infer<typeof variableIdSchema>;
export type ProfileQuery = z.infer<typeof profileQuerySchema>;
