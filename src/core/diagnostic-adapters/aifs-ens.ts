import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AifsEnsForecastService } from "../aifs-ens.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface AifsEnsDiagnosticAdapterOptions {
  aifsEnsDiagnostics?: Pick<AifsEnsForecastService, "diagnose">;
}

export class AifsEnsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<AifsEnsForecastService, "diagnose">;

  constructor(options: AifsEnsDiagnosticAdapterOptions = {}) {
    this.service = options.aifsEnsDiagnostics ?? new AifsEnsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
