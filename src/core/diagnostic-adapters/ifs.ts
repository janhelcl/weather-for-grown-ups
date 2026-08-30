import {
  publicDatasetMetadata,
  type DiagnoseAtmosphereRequest,
} from "../../schema/unified-api.js";
import {
  createGenericDiagnosticServices,
  diagnosticInstantCommon,
  diagnosticRangeCommon,
  runGenericInstantDiagnostic,
  type GenericDiagnosticAdapterOptions,
  type GenericDiagnosticServices,
} from "./helpers.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export type IfsDiagnosticAdapterOptions = GenericDiagnosticAdapterOptions;

export class IfsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly generic: GenericDiagnosticServices;

  constructor(options: IfsDiagnosticAdapterOptions = {}) {
    this.generic = createGenericDiagnosticServices(options);
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "ifs") {
      throw new Error("IFS diagnostic adapter only accepts dataset=ifs");
    }
    const model = publicDatasetMetadata("ifs").internalDatasetId;
    if ("at" in request.time) {
      const query = {
        ...diagnosticInstantCommon(request),
        ...request.diagnostic,
        run: request.forecast?.run ?? "latest",
      };
      return runGenericInstantDiagnostic(this.generic, request, model, query);
    }

    return this.generic.timeSeries.getDiagnosticTimeSeries({
      model,
      query: {
        ...diagnosticRangeCommon(request),
        run: request.forecast?.run ?? "latest",
      },
    } as any);
  }
}
