import {
  diagnoseAtmosphereSchema,
  publicDatasetMetadata,
  type DiagnoseAtmosphereInput,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import {
  parseQueryAtmosphereInput,
  type PublicQueryAtmosphereInput,
} from "../schema/unified-query-input.js";
import { assertAtmosphericQueryWithinBudget } from "./atmospheric-query-budget.js";
import { createAtmosphericQueryAdapterRegistry } from "./query-adapters/registry.js";
import type { AtmosphericProgressReporter } from "./progress.js";
import type { AtmosphericQueryAdapterRegistry } from "./query-adapters/types.js";
import { assertAtmosphericGeometryWithinDomain } from "./atmospheric-domain.js";
import { UnifiedAtmosphereDiagnosticService } from "./unified-atmosphere-diagnostics.js";
import { wrapUnifiedAtmosphereResult } from "./unified-atmosphere-result.js";

interface AtmosphericDiagnosticRunner {
  diagnose(input: DiagnoseAtmosphereInput): Promise<UnifiedAtmosphereResult>;
}

export interface UnifiedAtmosphereQueryServiceOptions {
  progress?: AtmosphericProgressReporter;
  adapters?: Partial<AtmosphericQueryAdapterRegistry>;
  diagnosticService?: AtmosphericDiagnosticRunner;
}

export class UnifiedAtmosphereQueryService {
  private readonly adapters: AtmosphericQueryAdapterRegistry;
  private readonly diagnosticService: AtmosphericDiagnosticRunner;

  constructor(options: UnifiedAtmosphereQueryServiceOptions = {}) {
    this.adapters = createAtmosphericQueryAdapterRegistry({
      ...(options.progress === undefined ? {} : { progress: options.progress }),
      ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    });
    this.diagnosticService = options.diagnosticService ?? new UnifiedAtmosphereDiagnosticService();
  }

  async query(input: PublicQueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const { request, diagnostics } = parseQueryAtmosphereInput(input);
    if (diagnostics.length > 0 && request.geometry.type !== "point") {
      throw new Error("Bundled diagnostics require point geometry");
    }

    // Validate every derived view before paying for state acquisition. This keeps
    // a bundled request atomic at the contract boundary: unsupported diagnostic
    // semantics fail before the raw query starts rather than after an expensive
    // download/decode has already completed.
    const diagnosticRequests = diagnostics.map((diagnostic) => diagnoseAtmosphereSchema.parse({
      dataset: request.dataset,
      geometry: request.geometry,
      time: request.time,
      diagnostic,
      ...(request.forecast === undefined ? {} : { forecast: request.forecast }),
      ...(request.ensemble === undefined ? {} : { ensemble: request.ensemble }),
      ...(request.source === undefined ? {} : { source: request.source }),
    }));

    const metadata = publicDatasetMetadata(request.dataset);
    assertAtmosphericGeometryWithinDomain(request.dataset, metadata.internalDatasetId, request.geometry);
    assertAtmosphericQueryWithinBudget(request);
    const result = await this.adapters[request.dataset].query(request);
    const state = wrapUnifiedAtmosphereResult(request, result);

    if (diagnosticRequests.length === 0) return state;

    const derived: Array<{
      diagnostic: (typeof diagnostics)[number];
      result: UnifiedAtmosphereResult["result"];
    }> = [];
    for (const diagnosticRequest of diagnosticRequests) {
      const diagnosticResult = await this.diagnosticService.diagnose(diagnosticRequest);
      derived.push({
        diagnostic: diagnosticRequest.diagnostic,
        result: diagnosticResult.result,
      });
    }

    return {
      ...state,
      result: {
        state: state.result,
        diagnostics: derived,
      },
    };
  }
}
