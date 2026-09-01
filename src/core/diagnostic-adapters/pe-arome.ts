import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export class PeAromeDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  async diagnose(_request: DiagnoseAtmosphereRequest): Promise<unknown> {
    throw new Error(
      "PE-AROME currently exposes the verified near-surface WCS field slice; pressure-based diagnostics are not yet advertised",
    );
  }
}
