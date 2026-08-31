import type {
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

