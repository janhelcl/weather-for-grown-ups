import {
  atmosphericLayerDiagnosticsRequestSchema,
  atmosphericLayerDiagnosticsResultSchema,
  type AtmosphericLayerDiagnosticsRequestInput,
  type AtmosphericLayerDiagnosticsResult,
} from "../schema/atmospheric-layer-diagnostics.js";
import type { GefsLayerDiagnosticsQueryInput, GefsLayerDiagnosticsResult } from "../schema/gefs-layer-diagnostics.js";
import type { LayerDiagnosticsQueryInput } from "../schema/query.js";
import type { LayerDiagnosticsResult } from "./types.js";
import { GefsLayerDiagnosticsService } from "./gefs-layer-diagnostics.js";
import { LayerDiagnosticsService } from "./layer-diagnostics.js";

export interface DeterministicLayerDiagnosticsGetter {
  getLayerDiagnostics(query: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult>;
}

export interface EnsembleLayerDiagnosticsGetter {
  getLayerDiagnostics(query: GefsLayerDiagnosticsQueryInput): Promise<GefsLayerDiagnosticsResult>;
}

export interface AtmosphericLayerDiagnosticsServiceOptions {
  gfs?: DeterministicLayerDiagnosticsGetter;
  gefs?: EnsembleLayerDiagnosticsGetter;
}

export class AtmosphericLayerDiagnosticsService {
  private readonly gfs: DeterministicLayerDiagnosticsGetter;
  private readonly gefs: EnsembleLayerDiagnosticsGetter;

  constructor(options: AtmosphericLayerDiagnosticsServiceOptions = {}) {
    this.gfs = options.gfs ?? new LayerDiagnosticsService();
    this.gefs = options.gefs ?? new GefsLayerDiagnosticsService();
  }

  async getLayerDiagnostics(input: AtmosphericLayerDiagnosticsRequestInput): Promise<AtmosphericLayerDiagnosticsResult> {
    const request = atmosphericLayerDiagnosticsRequestSchema.parse(input);
    const result = request.model === "gfs_0p25"
      ? await this.gfs.getLayerDiagnostics(request.query)
      : await this.gefs.getLayerDiagnostics(request.query);
    return atmosphericLayerDiagnosticsResultSchema.parse(result);
  }
}
