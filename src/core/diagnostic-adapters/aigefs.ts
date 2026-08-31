import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AigefsForecastService } from "../aigefs.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface AigefsDiagnosticAdapterOptions {
  aigefsDiagnostics?: Pick<AigefsForecastService, "diagnose">;
}

export class AigefsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<AigefsForecastService, "diagnose">;

  constructor(options: AigefsDiagnosticAdapterOptions = {}) {
    this.service = options.aigefsDiagnostics ?? new AigefsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
