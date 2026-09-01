import * as z from "zod/v4";
import {
  ATMOSPHERIC_DATASET_IDS,
  ATMOSPHERIC_OPERATION_IDS,
  ATMOSPHERIC_RUN_SELECTOR_IDS,
} from "../catalog/models.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  publicAtmosphericDatasetSchema,
} from "./unified-api.js";

export const UNIFIED_CATALOG_SECTIONS = [
  "variables",
  "fields",
  "layer_diagnostics",
  "profile_diagnostics",
  "parcel_definitions",
] as const;

export const unifiedCatalogSectionSchema = z.enum(UNIFIED_CATALOG_SECTIONS);

export const catalogCoverageGeometrySchema = z.union([
  z.object({
    type: z.literal("point"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  z.object({
    type: z.literal("area"),
    westLongitude: z.number().min(-180).max(180),
    eastLongitude: z.number().min(-180).max(180),
    southLatitude: z.number().min(-90).max(90),
    northLatitude: z.number().min(-90).max(90),
  }).superRefine((area, context) => {
    if (area.eastLongitude <= area.westLongitude) {
      context.addIssue({
        code: "custom",
        path: ["eastLongitude"],
        message: "eastLongitude must be greater than westLongitude",
      });
    }
    if (area.northLatitude <= area.southLatitude) {
      context.addIssue({
        code: "custom",
        path: ["northLatitude"],
        message: "northLatitude must be greater than southLatitude",
      });
    }
  }),
]);

export const searchAtmosphereCatalogSchema = z.object({
  search: z.string().min(1).optional(),
  datasets: z.array(publicAtmosphericDatasetSchema).min(1).max(PUBLIC_ATMOSPHERIC_DATASET_IDS.length)
    .default([...PUBLIC_ATMOSPHERIC_DATASET_IDS]),
  sections: z.array(unifiedCatalogSectionSchema).min(1).max(UNIFIED_CATALOG_SECTIONS.length)
    .optional(),
  classification: z.enum(["raw", "derived"]).optional(),
  temporalSemantics: z.enum(["instantaneous", "accumulation", "average", "maximum"]).optional(),
  spatialScope: z.enum(["global", "limited_area"]).optional().describe(
    "Dataset spatial-domain filter. limited_area selects regional/convection-permitting datasets.",
  ),
  coverage: catalogCoverageGeometrySchema.optional().describe(
    "Return only datasets whose declared spatial domain fully covers this point or bounded area.",
  ),
  forecastKind: z.enum(["operational", "reforecast"]).optional().describe(
    "Forecast population filter. Currently supported only with datasets=[gefs]; reforecast selects the GEFSv12 retrospective capability subset.",
  ),
  limit: z.number().int().min(1).max(100).default(30),
}).superRefine((query, context) => {
  if (new Set(query.datasets).size !== query.datasets.length) {
    context.addIssue({ code: "custom", path: ["datasets"], message: "datasets must not contain duplicates" });
  }
  if (query.sections !== undefined && new Set(query.sections).size !== query.sections.length) {
    context.addIssue({ code: "custom", path: ["sections"], message: "sections must not contain duplicates" });
  }
  if (
    query.forecastKind !== undefined
    && (query.datasets.length !== 1 || query.datasets[0] !== "gefs")
  ) {
    context.addIssue({
      code: "custom",
      path: ["forecastKind"],
      message: "forecastKind catalog filtering currently requires datasets=[gefs]",
    });
  }
});

export const unifiedCatalogMatchSchema = z.object({
  section: unifiedCatalogSectionSchema,
  id: z.string().min(1),
  classification: z.enum(["raw", "derived"]),
  kind: z.string().min(1),
  description: z.string().min(1),
  verticalSemantics: z.string().min(1),
  temporalSemantics: z.enum(["instantaneous", "accumulation", "average", "maximum"]).optional(),
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

export const unifiedDatasetCapabilitiesSchema = z.object({
  dataset: publicAtmosphericDatasetSchema,
  role: z.enum(["forecast", "analysis"]),
  kind: z.enum(["deterministic", "ensemble"]),
  modelClass: z.enum(["physics", "ai", "hybrid"]),
  provider: z.enum(["noaa", "ecmwf", "dwd", "meteo_france"]),
  spatialDomain: z.union([
    z.object({ scope: z.literal("global") }),
    z.object({
      scope: z.literal("limited_area"),
      name: z.string().min(1),
      bounds: z.object({
        westLongitude: z.number(),
        eastLongitude: z.number(),
        southLatitude: z.number(),
        northLatitude: z.number(),
      }),
    }),
  ]),
  nativeGrid: z.object({
    type: z.enum(["regular_latlon", "rotated_latlon", "icosahedral", "lambert_conformal", "mixed"]),
    nominalResolution: z.object({
      value: z.number().positive(),
      unit: z.enum(["degrees", "km"]),
    }).optional(),
    components: z.array(z.object({
      dataset: z.enum(ATMOSPHERIC_DATASET_IDS),
      type: z.enum(["regular_latlon", "rotated_latlon", "icosahedral", "lambert_conformal"]),
      nominalResolution: z.object({
        value: z.number().positive(),
        unit: z.enum(["degrees", "km"]),
      }),
    })).optional(),
  }),
  horizontalGridDegrees: z.number().positive().optional(),
  maxForecastHour: z.number().int().nonnegative().optional(),
  nativeTimeCadenceHours: z.array(z.number().positive()).min(1),
  nativeForecastIntervalHours: z.number().positive().optional(),
  members: z.number().int().positive().optional(),
  constituents: z.array(z.object({
    dataset: z.enum(ATMOSPHERIC_DATASET_IDS),
    modelClass: z.enum(["physics", "ai", "hybrid"]),
    members: z.number().int().positive(),
  })).optional(),
  forecastKinds: z.array(z.enum(["operational", "reforecast"])),
  runSelectors: z.array(z.enum(ATMOSPHERIC_RUN_SELECTOR_IDS)),
  operations: z.array(z.enum(ATMOSPHERIC_OPERATION_IDS)),
});

export const unifiedCatalogResultSchema = z.object({
  query: searchAtmosphereCatalogSchema,
  datasetCapabilities: z.array(unifiedDatasetCapabilitiesSchema),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  matches: z.array(unifiedCatalogMatchSchema),
});

export type SearchAtmosphereCatalogInput = z.input<typeof searchAtmosphereCatalogSchema>;
export type UnifiedCatalogResult = z.infer<typeof unifiedCatalogResultSchema>;
