import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AifsForecastService } from "../aifs.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface AifsDiagnosticAdapterOptions {
  aifsDiagnostics?: Pick<AifsForecastService, "diagnose">;
}

export class AifsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<AifsForecastService, "diagnose">;

  constructor(options: AifsDiagnosticAdapterOptions = {}) {
    this.service = options.aifsDiagnostics ?? new AifsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
