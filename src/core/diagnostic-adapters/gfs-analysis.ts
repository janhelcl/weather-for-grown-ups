import {
  publicDatasetMetadata,
  type DiagnoseAtmosphereRequest,
} from "../../schema/unified-api.js";
import {
  createGenericDiagnosticServices,
  diagnosticRangeCommon,
  runGenericInstantDiagnostic,
  type GenericDiagnosticAdapterOptions,
  type GenericDiagnosticServices,
} from "./helpers.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export type GfsAnalysisDiagnosticAdapterOptions = GenericDiagnosticAdapterOptions;

export class GfsAnalysisDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly generic: GenericDiagnosticServices;

  constructor(options: GfsAnalysisDiagnosticAdapterOptions = {}) {
    this.generic = createGenericDiagnosticServices(options);
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs-analysis") {
      throw new Error("GFS analysis diagnostic adapter only accepts dataset=gfs-analysis");
    }
    const model = publicDatasetMetadata("gfs-analysis").internalDatasetId;
    if ("at" in request.time) {
      const query = {
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        analysisTime: request.time.at,
        ...request.diagnostic,
      };
      return runGenericInstantDiagnostic(this.generic, request, model, query);
    }

    return this.generic.timeSeries.getDiagnosticTimeSeries({
      model,
      query: {
        ...diagnosticRangeCommon(request),
        ...(request.time.hoursUtc === undefined
          ? {}
          : { cycleHoursUtc: request.time.hoursUtc }),
      },
    } as any);
  }
}
