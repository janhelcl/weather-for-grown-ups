import {
  atmosphericLayerDiagnosticsRequestSchema,
  atmosphericLayerDiagnosticsResultSchema,
  type AtmosphericLayerDiagnosticsRequestInput,
  type AtmosphericLayerDiagnosticsResult,
} from "../schema/atmospheric-layer-diagnostics.js";
import type { GefsLayerDiagnosticsQueryInput, GefsLayerDiagnosticsResult } from "../schema/gefs-layer-diagnostics.js";
import type {
  HistoricalLayerDiagnosticsQueryInput,
  HistoricalLayerDiagnosticsResult,
} from "../schema/history-diagnostics.js";
import type { LayerDiagnosticsQueryInput } from "../schema/query.js";
import type { LayerDiagnosticsResult } from "./types.js";
import { GefsLayerDiagnosticsService } from "./gefs-layer-diagnostics.js";
import { HistoricalDiagnosticsService } from "./history-diagnostics.js";
import { LayerDiagnosticsService } from "./layer-diagnostics.js";

export interface DeterministicLayerDiagnosticsGetter {
  getLayerDiagnostics(query: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult>;
}

export interface EnsembleLayerDiagnosticsGetter {
  getLayerDiagnostics(query: GefsLayerDiagnosticsQueryInput): Promise<GefsLayerDiagnosticsResult>;
}

export interface HistoricalLayerDiagnosticsGetter {
  getLayerDiagnostics(query: HistoricalLayerDiagnosticsQueryInput): Promise<HistoricalLayerDiagnosticsResult>;
}

export interface AtmosphericLayerDiagnosticsServiceOptions {
  gfs?: DeterministicLayerDiagnosticsGetter;
  gefs?: EnsembleLayerDiagnosticsGetter;
  history?: HistoricalLayerDiagnosticsGetter;
}

export class AtmosphericLayerDiagnosticsService {
  private readonly gfs: DeterministicLayerDiagnosticsGetter;
  private readonly gefs: EnsembleLayerDiagnosticsGetter;
  private readonly history: HistoricalLayerDiagnosticsGetter;

  constructor(options: AtmosphericLayerDiagnosticsServiceOptions = {}) {
    this.gfs = options.gfs ?? new LayerDiagnosticsService();
    this.gefs = options.gefs ?? new GefsLayerDiagnosticsService();
    this.history = options.history ?? new HistoricalDiagnosticsService();
  }

  async getLayerDiagnostics(input: AtmosphericLayerDiagnosticsRequestInput): Promise<AtmosphericLayerDiagnosticsResult> {
    const request = atmosphericLayerDiagnosticsRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericLayerDiagnosticsResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericLayerDiagnosticsRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
        return this.gfs.getLayerDiagnostics(request.query);
      case "gfs_0p50":
        return this.gfs.getLayerDiagnostics({ ...request.query, grid: "0p50" });
      case "gefs_0p50":
        return this.gefs.getLayerDiagnostics(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getLayerDiagnostics(request.query);
    }
  }
}
