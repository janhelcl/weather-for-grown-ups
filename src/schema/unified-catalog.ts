import * as z from "zod/v4";
import { publicAtmosphericDatasetSchema } from "./unified-api.js";

export const UNIFIED_CATALOG_SECTIONS = [
  "variables",
  "fields",
  "layer_diagnostics",
  "profile_diagnostics",
  "parcel_definitions",
] as const;

export const unifiedCatalogSectionSchema = z.enum(UNIFIED_CATALOG_SECTIONS);

export const searchAtmosphereCatalogSchema = z.object({
  search: z.string().min(1).optional(),
  datasets: z.array(publicAtmosphericDatasetSchema).min(1).max(3)
    .default(["gfs", "gefs", "gfs-analysis"]),
  sections: z.array(unifiedCatalogSectionSchema).min(1).max(UNIFIED_CATALOG_SECTIONS.length)
    .optional(),
  classification: z.enum(["raw", "derived"]).optional(),
  temporalSemantics: z.enum(["instantaneous", "accumulation", "average"]).optional(),
  limit: z.number().int().min(1).max(100).default(30),
}).superRefine((query, context) => {
  if (new Set(query.datasets).size !== query.datasets.length) {
    context.addIssue({ code: "custom", path: ["datasets"], message: "datasets must not contain duplicates" });
  }
  if (query.sections !== undefined && new Set(query.sections).size !== query.sections.length) {
    context.addIssue({ code: "custom", path: ["sections"], message: "sections must not contain duplicates" });
  }
});

export const unifiedCatalogMatchSchema = z.object({
  section: unifiedCatalogSectionSchema,
  id: z.string().min(1),
  classification: z.enum(["raw", "derived"]),
  kind: z.string().min(1),
  description: z.string().min(1),
  verticalSemantics: z.string().min(1),
  temporalSemantics: z.enum(["instantaneous", "accumulation", "average"]).optional(),
  outputs: z.array(z.object({
    field: z.string().min(1),
    unit: z.string().min(1),
    description: z.string().optional(),
  })),
  support: z.array(z.object({
    dataset: publicAtmosphericDatasetSchema,
    semantics: z.string().min(1),
  })).min(1),
  score: z.number().nonnegative(),
});

export const unifiedCatalogResultSchema = z.object({
  query: searchAtmosphereCatalogSchema,
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  matches: z.array(unifiedCatalogMatchSchema),
});

export type SearchAtmosphereCatalogInput = z.input<typeof searchAtmosphereCatalogSchema>;
export type UnifiedCatalogResult = z.infer<typeof unifiedCatalogResultSchema>;
