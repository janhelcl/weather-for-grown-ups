import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { HgefsForecastService } from "../hgefs.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface HgefsDiagnosticAdapterOptions {
  hgefsDiagnostics?: Pick<HgefsForecastService, "diagnose">;
}

export class HgefsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<HgefsForecastService, "diagnose">;

  constructor(options: HgefsDiagnosticAdapterOptions = {}) {
    this.service = options.hgefsDiagnostics ?? new HgefsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
