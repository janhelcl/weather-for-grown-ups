import type {
  PublicAtmosphericDataset,
  QueryAtmosphereRequest,
} from "../../schema/unified-api.js";

export interface AtmosphericQueryAdapter {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
}

export type AtmosphericQueryAdapterRegistry = Record<
  PublicAtmosphericDataset,
  AtmosphericQueryAdapter
>;
