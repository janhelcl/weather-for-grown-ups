import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { IconD2ForecastService } from "../icon-d2.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface IconD2DiagnosticAdapterOptions {
  iconD2Diagnostics?: Pick<IconD2ForecastService, "diagnose">;
}

export class IconD2DiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<IconD2ForecastService, "diagnose">;

  constructor(options: IconD2DiagnosticAdapterOptions = {}) {
    this.service = options.iconD2Diagnostics ?? new IconD2ForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
