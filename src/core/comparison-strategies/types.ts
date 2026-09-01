import type {
  AtmosphericDatasetKind,
  AtmosphericModelClass,
  AtmosphericNativeGrid,
  AtmosphericProvider,
  AtmosphericSpatialDomain,
} from "../../catalog/models.js";
import {
  PUBLIC_DATASET_METADATA,
  publicDatasetCapabilities,
  type PublicAtmosphericDataset,
} from "../../schema/unified-api.js";
import type { CompareAtmosphericDatasetsRequest } from "../../schema/unified-specialized.js";

type DatasetComparisonKey<Request> =
  Request extends { datasets: [infer Left extends string, infer Right extends string] }
    ? `${Left}:${Right}`
    : never;

export type AtmosphericDatasetComparisonKey =
  DatasetComparisonKey<CompareAtmosphericDatasetsRequest>;

export type AtmosphericComparisonSemantics =
  | "deterministic_delta"
  | "deterministic_ensemble_positioning"
  | "ensemble_distribution_shift"
  | "hybrid_constituent_distribution_shift";

export type AtmosphericComparisonOutputShape =
  | "pair_native_result"
  | "normalized_pair_result"
  | "hybrid_constituent_result";

export type AtmosphericComparisonProvenanceShape =
  | "native_source_per_dataset"
  | "native_source_per_side"
  | "hybrid_constituent_sources";

export interface AtmosphericComparisonDatasetDescriptor {
  dataset: PublicAtmosphericDataset;
  resultKind: AtmosphericDatasetKind;
  modelClass: AtmosphericModelClass;
  provider: AtmosphericProvider;
  spatialDomain: AtmosphericSpatialDomain;
  nativeGrid: AtmosphericNativeGrid;
  horizontalGridDegrees?: number;
  maxForecastHour?: number;
  nativeTimeCadenceHours: readonly number[];
}

export interface AtmosphericDatasetComparisonStrategyMetadata {
  key: AtmosphericDatasetComparisonKey;
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset];
  left: AtmosphericComparisonDatasetDescriptor;
  right: AtmosphericComparisonDatasetDescriptor;
  runAlignment: "shared_initialization_cycle" | "shared_explicit_initialization_cycle";
  validTimeAlignment: "exact";
  variableCompatibility:
    | "pair_specific_pressure_scalar_intersection"
    | "pair_specific_pressure_or_field_intersection"
    | "pair_specific_field_intersection"
    | "pair_specific_scalar_pressure_or_field_intersection"
    | "pair_specific_scalar_field_intersection";
  spatialOverlapRequirement:
    | "requested_point_covered_by_both_datasets"
    | "requested_point_within_both_declared_domains";
  pointSamplingSemantics:
    | "independent_dataset_point_sampling"
    | "independent_native_grid_points_at_same_requested_coordinate";
  spatialAlignment:
    | "point_only_no_cross_dataset_regridding";
  nativeResolutionRepresentation:
    | "per_dataset_native_grid_and_source_provenance"
    | "preserve_per_side_native_grid_and_sampling_provenance";
  comparisonSemantics: AtmosphericComparisonSemantics;
  outputShape: AtmosphericComparisonOutputShape;
  provenanceShape: AtmosphericComparisonProvenanceShape;
}

export interface AtmosphericDatasetComparisonStrategy {
  readonly metadata: AtmosphericDatasetComparisonStrategyMetadata;
  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown>;
}

export type AtmosphericDatasetComparisonStrategyRegistry = Record<
  AtmosphericDatasetComparisonKey,
  AtmosphericDatasetComparisonStrategy
>;

export function atmosphericDatasetComparisonKey(
  request: CompareAtmosphericDatasetsRequest,
): AtmosphericDatasetComparisonKey {
  return `${request.datasets[0]}:${request.datasets[1]}` as AtmosphericDatasetComparisonKey;
}

export function comparisonStrategyMetadata(
  key: AtmosphericDatasetComparisonKey,
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset],
  comparisonSemantics: AtmosphericComparisonSemantics,
  options: {
    outputShape?: AtmosphericComparisonOutputShape;
    provenanceShape?: AtmosphericComparisonProvenanceShape;
    runAlignment?: AtmosphericDatasetComparisonStrategyMetadata["runAlignment"];
    variableCompatibility?: AtmosphericDatasetComparisonStrategyMetadata["variableCompatibility"];
    spatialOverlapRequirement?: AtmosphericDatasetComparisonStrategyMetadata["spatialOverlapRequirement"];
    pointSamplingSemantics?: AtmosphericDatasetComparisonStrategyMetadata["pointSamplingSemantics"];
    spatialAlignment?: AtmosphericDatasetComparisonStrategyMetadata["spatialAlignment"];
    nativeResolutionRepresentation?: AtmosphericDatasetComparisonStrategyMetadata["nativeResolutionRepresentation"];
  } = {},
): AtmosphericDatasetComparisonStrategyMetadata {
  const declaredKey = `${datasets[0]}:${datasets[1]}`;
  if (declaredKey !== key) {
    throw new Error(`Comparison strategy key ${key} does not match declared datasets ${declaredKey}`);
  }
  return {
    key,
    datasets,
    left: comparisonDatasetDescriptor(datasets[0]),
    right: comparisonDatasetDescriptor(datasets[1]),
    runAlignment: options.runAlignment ?? "shared_initialization_cycle",
    validTimeAlignment: "exact",
    variableCompatibility:
      options.variableCompatibility ?? "pair_specific_pressure_scalar_intersection",
    spatialOverlapRequirement:
      options.spatialOverlapRequirement ?? "requested_point_covered_by_both_datasets",
    pointSamplingSemantics:
      options.pointSamplingSemantics ?? "independent_dataset_point_sampling",
    spatialAlignment: options.spatialAlignment ?? "point_only_no_cross_dataset_regridding",
    nativeResolutionRepresentation:
      options.nativeResolutionRepresentation ?? "per_dataset_native_grid_and_source_provenance",
    comparisonSemantics,
    outputShape: options.outputShape ?? "pair_native_result",
    provenanceShape: options.provenanceShape ?? "native_source_per_dataset",
  };
}

function comparisonDatasetDescriptor(
  dataset: PublicAtmosphericDataset,
): AtmosphericComparisonDatasetDescriptor {
  const metadata = PUBLIC_DATASET_METADATA[dataset];
  const capabilities = publicDatasetCapabilities(dataset);
  return {
    dataset,
    resultKind: metadata.kind,
    modelClass: metadata.modelClass,
    provider: metadata.provider,
    spatialDomain: capabilities.spatialDomain,
    nativeGrid: capabilities.nativeGrid,
    ...(capabilities.horizontalGridDegrees === undefined
      ? {}
      : { horizontalGridDegrees: capabilities.horizontalGridDegrees }),
    ...(capabilities.maxForecastHour === undefined
      ? {}
      : { maxForecastHour: capabilities.maxForecastHour }),
    nativeTimeCadenceHours: capabilities.nativeTimeCadenceHours,
  };
}
