import * as z from "zod/v4";

export const variableIdSchema = z.enum([
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "wind",
]);

export const isoDateTimeSchema = z.string().refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an ISO-8601 date-time with timezone",
);

export const profileQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  run: isoDateTimeSchema.describe("GFS model initialization time"),
  validTime: isoDateTimeSchema.describe("Forecast valid time"),
  variables: z.array(variableIdSchema).min(1),
  pressureLevelsHpa: z.array(z.number().int().min(1).max(1100)).min(1),
});

export type VariableId = z.infer<typeof variableIdSchema>;
export type ProfileQuery = z.infer<typeof profileQuerySchema>;
