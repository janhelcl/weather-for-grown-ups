import {
  atmosphericParcelDiagnosticsRequestSchema,
  atmosphericParcelDiagnosticsResultSchema,
  type AtmosphericParcelDiagnosticsRequestInput,
  type AtmosphericParcelDiagnosticsResult,
} from "../schema/atmospheric-parcel-diagnostics.js";
import type {
  GefsParcelDiagnosticsQueryInput,
  GefsParcelDiagnosticsResult,
} from "../schema/gefs-parcel-diagnostics.js";
import type {
  HistoricalParcelQueryInput,
  HistoricalParcelResult,
} from "../schema/history-parcel.js";
import type { ParcelDiagnosticsQueryInput } from "../schema/query.js";
import type { ParcelDiagnosticsResult } from "./types.js";
import { GefsParcelDiagnosticsService } from "./gefs-parcel-diagnostics.js";
import { HistoricalParcelService } from "./history-parcel.js";
import { ParcelDiagnosticsService } from "./parcel-diagnostics.js";

export interface DeterministicParcelDiagnosticsGetter {
  getParcelDiagnostics(query: ParcelDiagnosticsQueryInput): Promise<ParcelDiagnosticsResult>;
}

export interface EnsembleParcelDiagnosticsGetter {
  getParcelDiagnostics(query: GefsParcelDiagnosticsQueryInput): Promise<GefsParcelDiagnosticsResult>;
}

export interface HistoricalParcelDiagnosticsGetter {
  getHistoricalParcel(query: HistoricalParcelQueryInput): Promise<HistoricalParcelResult>;
}

export interface AtmosphericParcelDiagnosticsServiceOptions {
  gfs?: DeterministicParcelDiagnosticsGetter;
  gefs?: EnsembleParcelDiagnosticsGetter;
  history?: HistoricalParcelDiagnosticsGetter;
}

export class AtmosphericParcelDiagnosticsService {
  private readonly gfs: DeterministicParcelDiagnosticsGetter;
  private readonly gefs: EnsembleParcelDiagnosticsGetter;
  private readonly history: HistoricalParcelDiagnosticsGetter;

  constructor(options: AtmosphericParcelDiagnosticsServiceOptions = {}) {
    this.gfs = options.gfs ?? new ParcelDiagnosticsService();
    this.gefs = options.gefs ?? new GefsParcelDiagnosticsService();
    this.history = options.history ?? new HistoricalParcelService();
  }

  async getParcelDiagnostics(input: AtmosphericParcelDiagnosticsRequestInput): Promise<AtmosphericParcelDiagnosticsResult> {
    const request = atmosphericParcelDiagnosticsRequestSchema.parse(input);
    const result = await this.route(request);
    return atmosphericParcelDiagnosticsResultSchema.parse(result);
  }

  private route(request: ReturnType<typeof atmosphericParcelDiagnosticsRequestSchema.parse>) {
    switch (request.model) {
      case "gfs_0p25":
      case "gfs_0p50":
        return this.gfs.getParcelDiagnostics(request.query);
      case "gefs_0p50":
        return this.gefs.getParcelDiagnostics(request.query);
      case "gfs_grid4_analysis_0p5":
        return this.history.getHistoricalParcel(request.query);
    }
  }
}
