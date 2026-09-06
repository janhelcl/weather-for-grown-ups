import { publicDatasetMetadata, type UnifiedAtmosphereResult } from "../schema/unified-api.js";
import { normalizeQueryAtmosphereInput, type PublicQueryAtmosphereInput } from "../schema/unified-query-input.js";
import { createAtmosphericQueryAdapterRegistry } from "./query-adapters/registry.js";
import type { AtmosphericProgressReporter } from "./progress.js";
import type { AtmosphericQueryAdapterRegistry } from "./query-adapters/types.js";
import { assertAtmosphericGeometryWithinDomain } from "./atmospheric-domain.js";
import { wrapUnifiedAtmosphereResult } from "./unified-atmosphere-result.js";

export interface UnifiedAtmosphereQueryServiceOptions {
  progress?: AtmosphericProgressReporter;
  adapters?: Partial<AtmosphericQueryAdapterRegistry>;
}

export class UnifiedAtmosphereQueryService {
  private readonly adapters: AtmosphericQueryAdapterRegistry;
  constructor(options: UnifiedAtmosphereQueryServiceOptions = {}) {
    this.adapters = createAtmosphericQueryAdapterRegistry({
      ...(options.progress === undefined ? {} : { progress: options.progress }),
      ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    });
  }
  async query(input: PublicQueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = normalizeQueryAtmosphereInput(input);
    const metadata = publicDatasetMetadata(request.dataset);
    assertAtmosphericGeometryWithinDomain(request.dataset, metadata.internalDatasetId, request.geometry);
    const result = await this.adapters[request.dataset].query(request);
    return wrapUnifiedAtmosphereResult(request, result);
  }
}
