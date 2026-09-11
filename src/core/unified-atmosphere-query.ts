import {
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
    this.diagnosticService = options.diagnosticService ?? new UnifiedAtmosphereDiagnosticService({
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    });
  }

  async query(input: PublicQueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const { request, diagnostics } = parseQueryAtmosphereInput(input);
    const metadata = publicDatasetMetadata(request.dataset);
    assertAtmosphericGeometryWithinDomain(request.dataset, metadata.internalDatasetId, request.geometry);
    assertAtmosphericQueryWithinBudget(request);
    const result = await this.adapters[request.dataset].query(request);
    const state = wrapUnifiedAtmosphereResult(request, result);

    if (diagnostics.length === 0) return state;
    if (request.geometry.type !== "point") {
      throw new Error("Bundled diagnostics require point geometry");
    }

    const derived: Array<{
      diagnostic: (typeof diagnostics)[number];
      result: UnifiedAtmosphereResult["result"];
    }> = [];
    for (const diagnostic of diagnostics) {
      const diagnosticResult = await this.diagnosticService.diagnose({
        dataset: request.dataset,
        geometry: request.geometry,
        time: request.time,
        diagnostic,
        ...(request.forecast === undefined ? {} : { forecast: request.forecast }),
        ...(request.ensemble === undefined ? {} : { ensemble: request.ensemble }),
        ...(request.source === undefined ? {} : { source: request.source }),
      });
      derived.push({
        diagnostic,
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
