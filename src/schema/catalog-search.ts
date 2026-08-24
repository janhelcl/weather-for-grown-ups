import * as z from "zod/v4";

export const catalogSearchSectionSchema = z.enum([
  "variables",
  "fields",
  "layer_diagnostics",
  "profile_diagnostics",
  "parcel_definitions",
]);

export const catalogSearchClassificationSchema = z.enum(["raw", "derived"]);
export const catalogSearchTemporalSchema = z.enum(["instantaneous", "accumulation", "average"]);

export const catalogSearchQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  sections: z.array(catalogSearchSectionSchema).min(1).optional(),
  classification: catalogSearchClassificationSchema.optional(),
  temporalSemantics: catalogSearchTemporalSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const catalogSearchOutputSchema = z.object({
  field: z.string(),
  unit: z.string(),
  description: z.string().optional(),
});

export const catalogSearchMatchSchema = z.object({
  section: catalogSearchSectionSchema,
  id: z.string(),
  classification: catalogSearchClassificationSchema,
  kind: z.string(),
  description: z.string(),
  verticalSemantics: z.string(),
  temporalSemantics: catalogSearchTemporalSchema.optional(),
  gfsCode: z.string().optional(),
  sourceUnit: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  outputs: z.array(catalogSearchOutputSchema),
  score: z.number(),
});

export const catalogSearchResultSchema = z.object({
  model: z.union([z.literal("gfs_0p25"), z.literal("gefs_0p50")]),
  query: z.object({
    search: z.string().optional(),
    sections: z.array(catalogSearchSectionSchema),
    classification: catalogSearchClassificationSchema.optional(),
    temporalSemantics: catalogSearchTemporalSchema.optional(),
    limit: z.number().int().min(1).max(100),
  }),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  matches: z.array(catalogSearchMatchSchema),
});

export type CatalogSearchSection = z.infer<typeof catalogSearchSectionSchema>;
export type CatalogSearchQueryInput = z.input<typeof catalogSearchQuerySchema>;
export type CatalogSearchQuery = z.output<typeof catalogSearchQuerySchema>;
export type CatalogSearchMatch = z.infer<typeof catalogSearchMatchSchema>;
export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;
