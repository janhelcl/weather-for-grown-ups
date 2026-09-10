import * as z from "zod/v4";
import { gfsGridSchema } from "./gfs-grid.js";
import {
  HISTORICAL_GFS_VARIABLE_IDS,
  historicalCycleHourUtcSchema,
} from "./history.js";
import { historicalVerificationLeadHoursSchema } from "./history-verification.js";
import {
  MAX_FORECAST_SKILL_EVALUATIONS,
  MAX_FORECAST_SKILL_LEADS,
  MAX_FORECAST_SKILL_VALID_TIMES,
} from "./forecast-skill.js";
import { IGRA_VERIFICATION_VARIABLE_IDS } from "./igra-verification.js";
import { isoDateTimeSchema, pointCoordinateSchema } from "./query.js";
import { publicAtmosphericDatasetSchema } from "./unified-api.js";

const verifyAtmosphericForecastCaseSchema = z.strictObject({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  leadHours: historicalVerificationLeadHoursSchema,
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  gfsGrid: gfsGridSchema.optional(),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).optional(),
}).superRefine((request, context) => {
  if (request.referenceDataset === "gfs-analysis") {
    for (const key of ["gfsGrid", "stationId", "maxStationDistanceKm"] as const) {
      if (request[key] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is only valid when referenceDataset=igra`,
        });
      }
    }
    return;
  }

  const supported = new Set<string>(IGRA_VERIFICATION_VARIABLE_IDS);
  const unsupported = request.variables.filter((variable) => !supported.has(variable));
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["variables"],
      message: `IGRA verification supports only ${IGRA_VERIFICATION_VARIABLE_IDS.join(", ")}; unsupported: ${unsupported.join(", ")}`,
    });
  }
});

const verifyAtmosphericForecastSkillSchema = z.strictObject({
  forecastDataset: z.literal("gfs").default("gfs"),
  referenceDataset: z.enum(["gfs-analysis", "igra"]).default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    hoursUtc: z.array(historicalCycleHourUtcSchema).min(1).max(4).default([0, 12]),
    maxValidTimes: z.number().int().min(1).max(MAX_FORECAST_SKILL_VALID_TIMES)
      .default(MAX_FORECAST_SKILL_VALID_TIMES),
  }),
  leadHours: z.array(historicalVerificationLeadHoursSchema).min(1).max(MAX_FORECAST_SKILL_LEADS),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  gfsGrid: gfsGridSchema.optional(),
  stationId: z.string().regex(/^[A-Z0-9]{11}$/).optional(),
  maxStationDistanceKm: z.number().positive().max(1_000).optional(),
}).superRefine((request, context) => {
  if (new Date(request.time.to) < new Date(request.time.from)) {
    context.addIssue({
      code: "custom",
      path: ["time", "to"],
      message: "time.to must be greater than or equal to time.from",
    });
  }
  if (new Set(request.time.hoursUtc).size !== request.time.hoursUtc.length) {
    context.addIssue({
      code: "custom",
      path: ["time", "hoursUtc"],
      message: "time.hoursUtc must not contain duplicates",
    });
  }
  if (new Set(request.leadHours).size !== request.leadHours.length) {
    context.addIssue({
      code: "custom",
      path: ["leadHours"],
      message: "leadHours must not contain duplicates",
    });
  }
  if (request.time.maxValidTimes * request.leadHours.length > MAX_FORECAST_SKILL_EVALUATIONS) {
    context.addIssue({
      code: "custom",
      path: ["time", "maxValidTimes"],
      message: `Forecast skill summary is bounded to ${MAX_FORECAST_SKILL_EVALUATIONS} forecast evaluations`,
    });
  }

  if (request.referenceDataset === "igra") {
    const supported = new Set<string>(IGRA_VERIFICATION_VARIABLE_IDS);
    const unsupported = request.variables.filter((variable) => !supported.has(variable));
    if (unsupported.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["variables"],
        message: `IGRA verification supports only ${IGRA_VERIFICATION_VARIABLE_IDS.join(", ")}; unsupported: ${unsupported.join(", ")}`,
      });
    }
    return;
  }

  for (const key of ["gfsGrid", "stationId", "maxStationDistanceKm"] as const) {
    if (request[key] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is only valid when referenceDataset=igra`,
      });
    }
  }
  const supported = new Set<string>(HISTORICAL_GFS_VARIABLE_IDS);
  const unsupported = request.variables.filter((variable) => !supported.has(variable));
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["variables"],
      message: `gfs-analysis verification does not support: ${unsupported.join(", ")}`,
    });
  }
});

/** Discovery-facing description of both verification forms (atomic case, skill summary). */
export const verifyAtmosphericForecastInputSchema = z.union([
  verifyAtmosphericForecastCaseSchema,
  verifyAtmosphericForecastSkillSchema,
]);

/**
 * Dispatches on the time form: `time.at` selects the atomic case contract,
 * `time.from`/`time.to` the skill-summary contract. Errors then name the field
 * inside the chosen form instead of a union-wide "Invalid input".
 */
export const verifyAtmosphericForecastSchema = z.any().transform((input, context) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    context.addIssue({
      code: "custom",
      message: "verify_forecast expects an object request with geometry, time, leadHours, variables and pressureLevelsHpa",
    });
    return z.NEVER;
  }
  const time = (input as { time?: unknown }).time;
  if (typeof time !== "object" || time === null) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: "time must be { at } for one verification case or { from, to } for a skill summary",
    });
    return z.NEVER;
  }
  const hasAt = (time as { at?: unknown }).at !== undefined;
  const hasRange = (time as { from?: unknown }).from !== undefined
    || (time as { to?: unknown }).to !== undefined;
  if (hasAt === hasRange) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: "Choose exactly one time form: time.at for one verification case, or time.from plus time.to for a skill summary",
    });
    return z.NEVER;
  }

  const form = hasAt ? "atomic" : "skill-summary";
  const parsed = (hasAt ? verifyAtmosphericForecastCaseSchema : verifyAtmosphericForecastSkillSchema)
    .safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: [...issue.path] as (string | number)[],
        message: `${issue.message} (${form} verification)`,
      });
    }
    return z.NEVER;
  }
  return parsed.data as z.infer<typeof verifyAtmosphericForecastInputSchema>;
}) as unknown as z.ZodType<
  z.infer<typeof verifyAtmosphericForecastInputSchema>,
  z.input<typeof verifyAtmosphericForecastInputSchema>
>;

export const findAtmosphericAnalogsSchema = z.strictObject({
  dataset: z.literal("gfs-analysis").default("gfs-analysis"),
  geometry: z.strictObject({ type: z.literal("point"), ...pointCoordinateSchema.shape }),
  time: z.strictObject({ at: isoDateTimeSchema }),
  variables: z.array(z.string().min(1)).min(1),
  pressureLevelsHpa: z.array(z.number().positive()).min(1),
  count: z.number().int().min(1).max(20).default(5),
  excludeWithinHours: z.number().int().min(0).max(24 * 31).default(24),
  fetchTargetIfMissing: z.boolean().default(true),
});

export const unifiedSpecializedResultSchema = z.object({
  operation: z.enum(["verify_forecast", "find_analogs"]),
  datasets: z.array(z.union([publicAtmosphericDatasetSchema, z.literal("igra")])).min(1),
  result: z.unknown(),
});

export type VerifyAtmosphericForecastInput = z.input<typeof verifyAtmosphericForecastSchema>;
export type VerifyAtmosphericForecastRequest = z.infer<typeof verifyAtmosphericForecastSchema>;
export type FindAtmosphericAnalogsInput = z.input<typeof findAtmosphericAnalogsSchema>;
export type FindAtmosphericAnalogsRequest = z.infer<typeof findAtmosphericAnalogsSchema>;
export type UnifiedSpecializedResult = z.infer<typeof unifiedSpecializedResultSchema>;
