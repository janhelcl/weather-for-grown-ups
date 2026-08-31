import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export class AromeDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  async diagnose(_request: DiagnoseAtmosphereRequest): Promise<unknown> {
    throw new Error(
      "AROME 0.01° currently exposes field-only queries; pressure-based diagnostics are not available from this product",
    );
  }
}
