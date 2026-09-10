import * as z from "zod/v4";
import { ATMOSPHERIC_OPERATION_IDS } from "../catalog/models.js";
import {
  atmosphericDiagnosticSelectionSchema,
  atmosphericEnsembleOptionsSchema,
  atmosphericForecastOptionsSchema,
  atmosphericGeometrySchema,
  atmosphericSelectionSchema,
  atmosphericTimeSchema,
  publicAtmosphericDatasetSchema,
} from "./unified-api.js";
import { unifiedDatasetCapabilitiesSchema } from "./unified-catalog.js";

export const inspectAtmosphereCapabilitiesSchema = z.strictObject({
  dataset: publicAtmosphericDatasetSchema,
  operation: z.enum(ATMOSPHERIC_OPERATION_IDS).optional().describe(
    "Optional exact operation the caller plans to use. Omit to inspect the dataset generally.",
  ),
  geometry: atmosphericGeometrySchema.optional().describe(
    "Optional planned geometry. Used for declared domain and geometry-support checks only; no data is fetched.",
  ),
  time: atmosphericTimeSchema.optional().describe(
    "Optional planned valid-time shape. Capability inspection checks contract compatibility, not live run availability.",
  ),
  selection: atmosphericSelectionSchema.optional(),
  diagnostic: atmosphericDiagnosticSelectionSchema.optional(),
  forecast: atmosphericForecastOptionsSchema.optional(),
  ensemble: atmosphericEnsembleOptionsSchema.optional(),
  source: z.enum(["nomads", "s3", "archive"]).optional(),
}).superRefine((query, context) => {
  if (query.selection !== undefined && query.diagnostic !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["diagnostic"],
      message: "Inspect either a query selection or a diagnostic selection in one capability check, not both",
    });
  }
});

const capabilityIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  reason: z.string().min(1),
});

export const capabilityInspectionResultSchema = z.object({
  basis: z.literal("declared_capability"),
  dataset: publicAtmosphericDatasetSchema,
  supported: z.boolean(),
  requested: inspectAtmosphereCapabilitiesSchema,
  geometries: z.array(z.enum(["point", "points", "transect", "area"])),
  capabilities: unifiedDatasetCapabilitiesSchema,
  unsupported: z.array(capabilityIssueSchema),
});

export type InspectAtmosphereCapabilitiesInput = z.input<typeof inspectAtmosphereCapabilitiesSchema>;
export type InspectAtmosphereCapabilitiesRequest = z.output<typeof inspectAtmosphereCapabilitiesSchema>;
export type CapabilityInspectionResult = z.infer<typeof capabilityInspectionResultSchema>;
