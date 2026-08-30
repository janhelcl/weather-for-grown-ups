import {
  queryAtmosphereSchema,
  type QueryAtmosphereInput,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import {
  createAtmosphericQueryAdapterRegistry,
  type AtmosphericQueryRegistryOptions,
} from "./query-adapters/registry.js";
import type { AtmosphericQueryAdapterRegistry } from "./query-adapters/types.js";
import { wrapUnifiedAtmosphereResult } from "./unified-atmosphere-result.js";

export interface UnifiedAtmosphereQueryServiceOptions extends AtmosphericQueryRegistryOptions {}

export class UnifiedAtmosphereQueryService {
  private readonly adapters: AtmosphericQueryAdapterRegistry;

  constructor(options: UnifiedAtmosphereQueryServiceOptions = {}) {
    this.adapters = createAtmosphericQueryAdapterRegistry(options);
  }

  async query(input: QueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = queryAtmosphereSchema.parse(input);
    const result = await this.adapters[request.dataset].query(request);
    return wrapUnifiedAtmosphereResult(request, result);
  }
}
