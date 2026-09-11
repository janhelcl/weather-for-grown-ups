import * as z from "zod/v4";
import { atmosphericGeometrySchema, atmosphericTimeSchema, publicAtmosphericDatasetSchema } from "./unified-api.js";
import { queryAtmosphereInputSchema } from "./unified-query-input.js";

export const atmosphericCoverageStatusSchema = z.enum(["complete", "partial", "absent"]);

const availabilityIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  reason: z.string().min(1),
});

const validTimeRangeSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const inspectAtmosphereAvailabilitySchema = queryAtmosphereInputSchema.describe(
  "Preflight the same dataset × geometry × time × selection request accepted by query_atmosphere, without downloading forecast payloads.",
);

export const atmosphereAvailabilityResultSchema = z.object({
  basis: z.enum(["live_product_probe", "declared_explicit_run"]),
  dataset: publicAtmosphericDatasetSchema,
  geometry: atmosphericGeometrySchema,
  requestedTime: atmosphericTimeSchema,
  domainCovered: z.boolean(),
  coverage: atmosphericCoverageStatusSchema,
  initialization: z.string().datetime({ offset: true }).optional(),
  initializationValidTimeRange: validTimeRangeSchema.optional(),
  availableRequestedTime: validTimeRangeSchema.optional(),
  nativeCadenceHours: z.array(z.number().positive()),
  maxForecastHour: z.number().int().nonnegative().optional(),
  issues: z.array(availabilityIssueSchema),
});

export type InspectAtmosphereAvailabilityInput = z.input<typeof inspectAtmosphereAvailabilitySchema>;
export type AtmosphereAvailabilityResult = z.infer<typeof atmosphereAvailabilityResultSchema>;