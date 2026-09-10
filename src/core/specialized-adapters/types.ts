import type {
  FindAtmosphericAnalogsRequest,
  VerifyAtmosphericForecastRequest,
} from "../../schema/unified-specialized.js";

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
