import { operationalGfsModelId } from "../../schema/gfs-grid.js";
import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { ArchivedGfsForecastDiagnosticService } from "../archived-gfs-diagnostics.js";
import { shouldUseArchivedGfsForecast } from "../archived-gfs-query.js";
import {
  createGenericDiagnosticServices,
  diagnosticInstantCommon,
  diagnosticRangeCommon,
  runGenericInstantDiagnostic,
  type GenericDiagnosticAdapterOptions,
  type GenericDiagnosticServices,
} from "./helpers.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface GfsDiagnosticAdapterOptions extends GenericDiagnosticAdapterOptions {
  archivedGfs?: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  now?: () => Date;
}

export class GfsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly generic: GenericDiagnosticServices;
  private readonly archived: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  private readonly now: () => Date;

  constructor(options: GfsDiagnosticAdapterOptions = {}) {
    this.generic = createGenericDiagnosticServices(options);
    this.archived = options.archivedGfs ?? new ArchivedGfsForecastDiagnosticService();
    this.now = options.now ?? (() => new Date());
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") {
      throw new Error("GFS diagnostic adapter only accepts dataset=gfs");
    }
    if (shouldUseArchivedGfsForecast(request, this.now())) {
      return this.archived.diagnose(request);
    }
    const model = operationalGfsModelId(request.forecast?.grid ?? "0p25");
    if ("at" in request.time) {
      const query = {
        ...diagnosticInstantCommon(request),
        ...request.diagnostic,
        run: request.forecast?.run ?? "latest",
        grid: request.forecast?.grid ?? "0p25",
        source: request.source ?? "s3",
      };
      return runGenericInstantDiagnostic(this.generic, request, model, query);
    }
    return this.generic.timeSeries.getDiagnosticTimeSeries({
      model,
      query: {
        ...diagnosticRangeCommon(request),
        run: request.forecast?.run ?? "latest",
        grid: request.forecast?.grid ?? "0p25",
        source: request.source ?? "s3",
      },
    } as any);
  }
}
