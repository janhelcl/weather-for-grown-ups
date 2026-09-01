import * as z from "zod/v4";
import {
  NON_ISOBARIC_NAMED_LAYER_IDS,
  NON_ISOBARIC_NAMED_LEVEL_IDS,
} from "../catalog/non-isobaric-fields.js";
import { operationalGfsModelIdSchema } from "./gfs-grid.js";
import {
  isoDateTimeSchema,
  layerDiagnosticIdSchema,
  nonIsobaricFieldIdSchema,
  parcelDefinitionIdSchema,
  rawVariableIdSchema,
} from "./query.js";

export const sourceProvenanceSchema = z.object({
  provider: z.union([z.literal("NOAA NOMADS"), z.literal("NOAA AWS Open Data")]),
  access: z.union([z.literal("nomads_grib_filter"), z.literal("nomads_range"), z.literal("s3_range")]),
  decoder: z.enum(["gribberish", "wgrib2"]),
});

export const profileLevelResultSchema = z.object({
  pressureHpa: z.number(),
  temperatureC: z.number().optional(),
  relativeHumidityPct: z.number().optional(),
  uWindMs: z.number().optional(),
  vWindMs: z.number().optional(),
  geopotentialHeightGpm: z.number().optional(),
  specificHumidityKgKg: z.number().optional(),
  verticalVelocityPaS: z.number().optional(),
  geometricVerticalVelocityMs: z.number().optional(),
  absoluteVorticityS1: z.number().optional(),
  divergenceS1: z.number().optional(),
  totalCloudCoverPct: z.number().optional(),
  cloudWaterMixingRatioKgKg: z.number().optional(),
  ozoneMixingRatioKgKg: z.number().optional(),
  windSpeedMs: z.number().optional(),
  windDirectionDeg: z.number().optional(),
  dewPointC: z.number().optional(),
  potentialTemperatureK: z.number().optional(),
  mixingRatioKgKg: z.number().optional(),
  virtualTemperatureC: z.number().optional(),
  airDensityKgM3: z.number().optional(),
  wetBulbTemperatureC: z.number().optional(),
  equivalentPotentialTemperatureK: z.number().optional(),
});

export const nonIsobaricFieldLevelResultSchema = z.union([
  z.object({ type: z.literal("surface") }),
  z.object({ type: z.literal("height_above_ground_m"), heightM: z.number() }),
  z.object({ type: z.literal("named_layer"), id: z.enum(NON_ISOBARIC_NAMED_LAYER_IDS) }),
  z.object({ type: z.literal("named_level"), id: z.enum(NON_ISOBARIC_NAMED_LEVEL_IDS) }),
]);

const intervalTemporalResultShape = {
  startForecastHour: z.number(),
  endForecastHour: z.number(),
  startTime: isoDateTimeSchema,
  endTime: isoDateTimeSchema,
};

export const fieldTemporalResultSchema = z.union([
  z.object({ type: z.literal("instantaneous") }),
  z.object({ type: z.literal("accumulation"), ...intervalTemporalResultShape }),
  z.object({ type: z.literal("average"), ...intervalTemporalResultShape }),
  z.object({ type: z.literal("maximum"), ...intervalTemporalResultShape }),
]);

export const nonIsobaricFieldResultSchema = z.object({
  id: nonIsobaricFieldIdSchema,
  level: nonIsobaricFieldLevelResultSchema,
  temporal: fieldTemporalResultSchema,
  values: z.record(z.string(), z.number()),
});

export const gridPointSchema = z.object({ latitude: z.number(), longitude: z.number() });

export const profileResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
  source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
});

export const layerDiagnosticResultSchema = z.object({
  id: layerDiagnosticIdSchema,
  values: z.record(z.string(), z.number()),
});

export const layerDiagnosticsResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  layer: z.object({
    lowerPressureHpa: z.number(),
    upperPressureHpa: z.number(),
    lowerGeopotentialHeightGpm: z.number(),
    upperGeopotentialHeightGpm: z.number(),
    depthGpm: z.number().positive(),
  }),
  levels: z.array(profileLevelResultSchema).length(2),
  diagnostics: z.array(layerDiagnosticResultSchema).min(1),
  source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
});

const sampledThermodynamicLevelSchema = z.object({
  pressureHpa: z.number().positive(),
  geopotentialHeightGpm: z.number(),
  temperatureC: z.number(),
});

const freezingLevelCrossingSchema = z.object({
  pressureHpa: z.number().positive(),
  geopotentialHeightGpm: z.number(),
  method: z.enum(["interpolated", "exact_sample"]),
  transition: z.enum(["warm_to_cold", "cold_to_warm", "indeterminate"]),
  lowerLevel: sampledThermodynamicLevelSchema,
  upperLevel: sampledThermodynamicLevelSchema,
});

const temperatureInversionLayerSchema = z.object({
  basePressureHpa: z.number().positive(),
  topPressureHpa: z.number().positive(),
  baseGeopotentialHeightGpm: z.number(),
  topGeopotentialHeightGpm: z.number(),
  baseTemperatureC: z.number(),
  topTemperatureC: z.number(),
  depthGpm: z.number().positive(),
  temperatureIncreaseC: z.number().positive(),
  meanTemperatureGradientCPerKm: z.number().positive(),
  sampledSegments: z.number().int().positive(),
});

export const profileDiagnosticResultSchema = z.discriminatedUnion("id", [
  z.object({
    id: z.literal("freezing_level_crossings"),
    crossings: z.array(freezingLevelCrossingSchema),
  }),
  z.object({
    id: z.literal("temperature_inversion_layers"),
    layers: z.array(temperatureInversionLayerSchema),
  }),
]);

export const profileDiagnosticsResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  diagnostics: z.array(profileDiagnosticResultSchema).min(1),
  source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
});

const parcelBoundarySchema = z.object({
  pressureHpa: z.number().positive(),
  geopotentialHeightGpm: z.number().optional(),
});

const parcelStartingStateSchema = z.object({
  definition: parcelDefinitionIdSchema,
  source: z.enum(["surface_2m", "mixed_layer_mean", "isobaric_sample"]),
  pressureHpa: z.number().positive(),
  geopotentialHeightGpm: z.number(),
  temperatureC: z.number(),
  specificHumidityKgKg: z.number().min(0).max(1),
  construction: z.object({
    layerBottomPressureHpa: z.number().positive().optional(),
    layerTopPressureHpa: z.number().positive().optional(),
    sampledLevels: z.number().int().positive().optional(),
    selectedEquivalentPotentialTemperatureK: z.number().positive().optional(),
    candidateLevels: z.number().int().positive().optional(),
  }).optional(),
});

const parcelPathLevelSchema = z.object({
  pressureHpa: z.number().positive(),
  geopotentialHeightGpm: z.number(),
  source: z.enum(["parcel_start", "sampled", "interpolated_lcl", "interpolated_buoyancy_crossing"]),
  phase: z.enum(["dry", "saturated"]),
  environmentTemperatureC: z.number(),
  environmentSpecificHumidityKgKg: z.number().min(0).max(1),
  environmentVirtualTemperatureK: z.number().positive(),
  parcelTemperatureC: z.number(),
  parcelSpecificHumidityKgKg: z.number().min(0).max(1),
  parcelVirtualTemperatureK: z.number().positive(),
  virtualTemperatureExcessK: z.number(),
});

export const parcelComputationSchema = z.object({
  startingState: parcelStartingStateSchema,
  lcl: parcelBoundarySchema.extend({
    temperatureC: z.number(),
    dewPointC: z.number(),
    withinProfile: z.boolean(),
  }),
  lfc: parcelBoundarySchema.optional(),
  el: parcelBoundarySchema.optional(),
  capeJkg: z.number().nonnegative(),
  cinJkg: z.number().nonpositive(),
  capeTop: z.enum(["equilibrium_level", "profile_top", "no_lfc"]),
  cinTop: z.enum(["lfc", "profile_top"]),
  parcelPath: z.array(parcelPathLevelSchema).min(2),
});

export const parcelDiagnosticsResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  sampledPressureLevelsHpa: z.array(z.number().positive()).min(2),
  levels: z.array(profileLevelResultSchema).min(2),
  parcel: parcelComputationSchema,
  source: sourceProvenanceSchema.extend({ cacheHit: z.boolean() }),
});

export const batchPointResultSchema = z.object({
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  levels: z.array(profileLevelResultSchema),
  fields: z.array(nonIsobaricFieldResultSchema).optional(),
});

export const batchPointsResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  points: z.array(batchPointResultSchema),
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    cacheHit: z.boolean(),
  }),
});

export const timeSeriesResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  source: sourceProvenanceSchema,
  series: z.array(z.object({
    validTime: isoDateTimeSchema,
    forecastHour: z.number(),
    levels: z.array(profileLevelResultSchema),
    fields: z.array(nonIsobaricFieldResultSchema).optional(),
    cacheHit: z.boolean(),
  })),
});

export const pointsTimeSeriesResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  requestedStartTime: isoDateTimeSchema,
  requestedEndTime: isoDateTimeSchema,
  source: z.object({
    provider: z.literal("NOAA AWS Open Data"),
    access: z.literal("s3_range"),
    decoder: z.enum(["gribberish", "wgrib2"]),
  }),
  series: z.array(z.object({
    validTime: isoDateTimeSchema,
    forecastHour: z.number(),
    points: z.array(batchPointResultSchema),
    cacheHit: z.boolean(),
  })),
});

export const areaSummaryResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  validTime: isoDateTimeSchema,
  forecastHour: z.number(),
  bbox: z.object({
    westLongitude: z.number(),
    eastLongitude: z.number(),
    southLatitude: z.number(),
    northLatitude: z.number(),
  }),
  variable: z.object({
    id: rawVariableIdSchema,
    pressureHpa: z.number(),
    field: z.string(),
    unit: z.string(),
  }).optional(),
  field: z.object({
    id: nonIsobaricFieldIdSchema,
    level: nonIsobaricFieldLevelResultSchema,
    temporal: fieldTemporalResultSchema,
    output: z.object({ field: z.string(), unit: z.string() }),
  }).optional(),
  statistics: z.object({
    definedGridPoints: z.number(),
    mean: z.number(),
    min: z.number(),
    max: z.number(),
    meanKind: z.literal("unweighted_grid_point_mean"),
  }),
  source: z.object({
    provider: z.literal("NOAA NOMADS"),
    access: z.literal("nomads_grib_filter"),
    decoder: z.enum(["gribberish", "wgrib2"]),
    cacheHit: z.boolean(),
  }),
}).superRefine((value, context) => {
  const descriptorCount = Number(value.variable !== undefined) + Number(value.field !== undefined);
  if (descriptorCount !== 1) {
    context.addIssue({
      code: "custom",
      path: ["field"],
      message: "Area summary result must describe exactly one pressure-level variable or non-isobaric field",
    });
  }
});

export const latestGfsRunResultSchema = z.object({
  model: operationalGfsModelIdSchema,
  run: isoDateTimeSchema,
  completeness: z.literal("f384"),
  discoverySource: z.literal("NOAA AWS Open Data"),
});
