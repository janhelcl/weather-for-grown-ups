import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { IconD2EpsForecastService } from "../icon-d2-eps.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface IconD2EpsDiagnosticAdapterOptions {
  iconD2EpsDiagnostics?: Pick<IconD2EpsForecastService, "diagnose">;
}

export class IconD2EpsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly service: Pick<IconD2EpsForecastService, "diagnose">;

  constructor(options: IconD2EpsDiagnosticAdapterOptions = {}) {
    this.service = options.iconD2EpsDiagnostics ?? new IconD2EpsForecastService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    return this.service.diagnose(request);
  }
}
