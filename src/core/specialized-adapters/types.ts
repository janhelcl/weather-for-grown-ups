import type {
  CompareAtmosphericDatasetsRequest,
  CompareAtmosphericRunsRequest,
  FindAtmosphericAnalogsRequest,
  VerifyAtmosphericForecastRequest,
} from "../../schema/unified-specialized.js";

export interface AtmosphericRunComparisonAdapter {
  compare(request: CompareAtmosphericRunsRequest): Promise<unknown>;
}

export type AtmosphericRunComparisonAdapterRegistry = Record<
  CompareAtmosphericRunsRequest["dataset"],
  AtmosphericRunComparisonAdapter
>;

export interface AtmosphericDatasetComparisonAdapter {
  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown>;
}

type DatasetComparisonKey<Request> =
  Request extends { datasets: [infer Left extends string, infer Right extends string] }
    ? `${Left}:${Right}`
    : never;

export type AtmosphericDatasetComparisonKey =
  DatasetComparisonKey<CompareAtmosphericDatasetsRequest>;

export type AtmosphericDatasetComparisonAdapterRegistry = Record<
  AtmosphericDatasetComparisonKey,
  AtmosphericDatasetComparisonAdapter
>;

export interface AtmosphericVerificationAdapter {
  verify(request: VerifyAtmosphericForecastRequest): Promise<unknown>;
}

export type AtmosphericVerificationAdapterRegistry = Record<
  VerifyAtmosphericForecastRequest["referenceDataset"],
  AtmosphericVerificationAdapter
>;

export interface AtmosphericAnalogAdapter {
  find(request: FindAtmosphericAnalogsRequest): Promise<unknown>;
}

export type AtmosphericAnalogAdapterRegistry = Record<
  FindAtmosphericAnalogsRequest["dataset"],
  AtmosphericAnalogAdapter
>;

export function atmosphericDatasetComparisonKey(
  request: CompareAtmosphericDatasetsRequest,
): AtmosphericDatasetComparisonKey {
  return `${request.datasets[0]}:${request.datasets[1]}` as AtmosphericDatasetComparisonKey;
}
