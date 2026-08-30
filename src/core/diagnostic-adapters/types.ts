import type {
  DiagnoseAtmosphereRequest,
  PublicAtmosphericDataset,
} from "../../schema/unified-api.js";

export interface AtmosphericDiagnosticAdapter {
  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;
}

export type AtmosphericDiagnosticAdapterRegistry = Record<
  PublicAtmosphericDataset,
  AtmosphericDiagnosticAdapter
>;
