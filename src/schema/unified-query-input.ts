import * as z from "zod/v4";
import {
  atmosphericDiagnosticSelectionSchema,
  atmosphericSelectionSchema,
  queryAtmosphereSchema,
  type PublicAtmosphericDataset,
  type QueryAtmosphereInput,
  type QueryAtmosphereRequest,
} from "./unified-api.js";

export const DEFAULT_ATMOSPHERIC_PRESSURE_VARIABLES = [
  "temperature",
  "relative_humidity",
  "u_wind",
  "v_wind",
  "geopotential_height",
] as const;
export const DEFAULT_ATMOSPHERIC_PRESSURE_LEVELS_HPA = [1000, 925, 850, 700, 500] as const;
export const DEFAULT_ICON_D2_PRESSURE_LEVELS_HPA = [1000, 950, 850, 700, 500] as const;
const FIELD_ONLY_DATASETS = new Set<PublicAtmosphericDataset>(["arome", "pe-arome"]);
const ICON_D2_DATASETS = new Set<PublicAtmosphericDataset>(["icon-d2", "icon-d2-eps"]);

export const queryAtmosphereInputSchema = z.strictObject({
  ...queryAtmosphereSchema.shape,
  selection: atmosphericSelectionSchema.optional(),
  diagnostics: z.array(atmosphericDiagnosticSelectionSchema)
    .min(1)
    .optional()
    .describe("Optional point-only derived layer/profile/parcel views to return alongside raw atmospheric state. Derived diagnostics remain separate from the raw-state result and reuse compatible atmospheric evidence internally."),
}).superRefine((input, context) => {
  if (input.diagnostics !== undefined && input.geometry.type !== "point") {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message: "Bundled diagnostics require point geometry",
    });
  }
});

export type PublicQueryAtmosphereInput = z.input<typeof queryAtmosphereInputSchema>;
export type PublicQueryAtmosphereDiagnostic = z.output<typeof atmosphericDiagnosticSelectionSchema>;

export interface ParsedQueryAtmosphereInput {
  request: QueryAtmosphereRequest;
  diagnostics: PublicQueryAtmosphereDiagnostic[];
}

export function defaultAtmosphericSelection(
  dataset: PublicAtmosphericDataset,
): QueryAtmosphereInput["selection"] {
  if (FIELD_ONLY_DATASETS.has(dataset)) return { fields: ["temperature_2m"] };
  return {
    variables: [...DEFAULT_ATMOSPHERIC_PRESSURE_VARIABLES],
    pressureLevelsHpa: ICON_D2_DATASETS.has(dataset)
      ? [...DEFAULT_ICON_D2_PRESSURE_LEVELS_HPA]
      : [...DEFAULT_ATMOSPHERIC_PRESSURE_LEVELS_HPA],
  };
}

export function parseQueryAtmosphereInput(
  input: PublicQueryAtmosphereInput,
): ParsedQueryAtmosphereInput {
  const parsed = queryAtmosphereInputSchema.parse(input);
  const { diagnostics = [], ...query } = parsed;
  return {
    request: queryAtmosphereSchema.parse({
      ...query,
      selection: query.selection ?? defaultAtmosphericSelection(query.dataset),
    }),
    diagnostics,
  };
}

export function normalizeQueryAtmosphereInput(
  input: PublicQueryAtmosphereInput,
): QueryAtmosphereRequest {
  return parseQueryAtmosphereInput(input).request;
}
