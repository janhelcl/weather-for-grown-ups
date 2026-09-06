import * as z from "zod/v4";
import { atmosphericSelectionSchema, queryAtmosphereSchema, type PublicAtmosphericDataset, type QueryAtmosphereInput, type QueryAtmosphereRequest } from "./unified-api.js";

export const DEFAULT_ATMOSPHERIC_PRESSURE_VARIABLES = ["temperature", "relative_humidity", "u_wind", "v_wind", "geopotential_height"] as const;
export const DEFAULT_ATMOSPHERIC_PRESSURE_LEVELS_HPA = [1000, 925, 850, 700, 500] as const;
const FIELD_ONLY_DATASETS = new Set<PublicAtmosphericDataset>(["arome", "pe-arome"]);

export const queryAtmosphereInputSchema = z.strictObject({
  ...queryAtmosphereSchema.shape,
  selection: atmosphericSelectionSchema.optional(),
});
export type PublicQueryAtmosphereInput = z.input<typeof queryAtmosphereInputSchema>;

export function defaultAtmosphericSelection(dataset: PublicAtmosphericDataset): QueryAtmosphereInput["selection"] {
  if (FIELD_ONLY_DATASETS.has(dataset)) return { fields: ["temperature_2m"] };
  return { variables: [...DEFAULT_ATMOSPHERIC_PRESSURE_VARIABLES], pressureLevelsHpa: [...DEFAULT_ATMOSPHERIC_PRESSURE_LEVELS_HPA] };
}

export function normalizeQueryAtmosphereInput(input: PublicQueryAtmosphereInput): QueryAtmosphereRequest {
  const parsed = queryAtmosphereInputSchema.parse(input);
  return queryAtmosphereSchema.parse({ ...parsed, selection: parsed.selection ?? defaultAtmosphericSelection(parsed.dataset) });
}
