import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AigfsForecastService } from "../aigfs.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface AigfsDiagnosticAdapterOptions {
  aigfsDiagnostics?: Pick<AigfsForecastService, "diagnose">;
}

export class AigfsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<AigfsForecastService, "diagnose">;

  constructor(options: AigfsDiagnosticAdapterOptions = {}) {
    this.service = options.aigfsDiagnostics ?? new AigfsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
