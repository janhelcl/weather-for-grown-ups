import type {
  AtmosphericDatasetKind,
  AtmosphericModelClass,
  AtmosphericProvider,
} from "../../catalog/models.js";
import {
  PUBLIC_DATASET_METADATA,
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
}

export interface AtmosphericDatasetComparisonStrategyMetadata {
  key: AtmosphericDatasetComparisonKey;
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset];
  left: AtmosphericComparisonDatasetDescriptor;
  right: AtmosphericComparisonDatasetDescriptor;
  runAlignment: "shared_initialization_cycle";
  validTimeAlignment: "exact";
  variableCompatibility: "pair_specific_pressure_scalar_intersection";
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
  shapes: {
    outputShape?: AtmosphericComparisonOutputShape;
    provenanceShape?: AtmosphericComparisonProvenanceShape;
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
    runAlignment: "shared_initialization_cycle",
    validTimeAlignment: "exact",
    variableCompatibility: "pair_specific_pressure_scalar_intersection",
    comparisonSemantics,
    outputShape: shapes.outputShape ?? "pair_native_result",
    provenanceShape: shapes.provenanceShape ?? "native_source_per_dataset",
  };
}

function comparisonDatasetDescriptor(
  dataset: PublicAtmosphericDataset,
): AtmosphericComparisonDatasetDescriptor {
  const metadata = PUBLIC_DATASET_METADATA[dataset];
  return {
    dataset,
    resultKind: metadata.kind,
    modelClass: metadata.modelClass,
    provider: metadata.provider,
  };
}
