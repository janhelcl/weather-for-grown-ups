import {
  diagnoseAtmosphereSchema,
  publicDatasetMetadata,
  type DiagnoseAtmosphereInput,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import { createAtmosphericDiagnosticAdapterRegistry } from "./diagnostic-adapters/registry.js";
import type { AtmosphericDiagnosticAdapterRegistry } from "./diagnostic-adapters/types.js";
import { assertAtmosphericGeometryWithinDomain } from "./atmospheric-domain.js";
import { wrapUnifiedAtmosphereResult } from "./unified-atmosphere-result.js";

export interface UnifiedAtmosphereDiagnosticServiceOptions {
  adapters?: Partial<AtmosphericDiagnosticAdapterRegistry>;
}

export class UnifiedAtmosphereDiagnosticService {
  private readonly adapters: AtmosphericDiagnosticAdapterRegistry;

  constructor(options: UnifiedAtmosphereDiagnosticServiceOptions = {}) {
    this.adapters = createAtmosphericDiagnosticAdapterRegistry({
      ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    });
  }

  async diagnose(input: DiagnoseAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = diagnoseAtmosphereSchema.parse(input);
    const metadata = publicDatasetMetadata(request.dataset);
    assertAtmosphericGeometryWithinDomain(
      request.dataset,
      metadata.internalDatasetId,
      request.geometry,
    );
    const result = await this.adapters[request.dataset].diagnose(request);
    return wrapUnifiedAtmosphereResult(request, result);
  }
}
