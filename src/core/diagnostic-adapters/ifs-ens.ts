import { ifsEnsDiagnosticTimeSeriesQuerySchema } from "../../schema/ifs-ens-diagnostic-timeseries.js";
import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { IfsEnsDiagnosticTimeSeriesService } from "../ifs-ens-diagnostic-timeseries.js";
import { IfsEnsDiagnosticsService } from "../ifs-ens-diagnostics.js";
import {
  diagnosticRangeCommon,
} from "./helpers.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface IfsEnsDiagnosticAdapterOptions {
  ifsEns?: Pick<
    IfsEnsDiagnosticsService,
    "getLayerDiagnostics" | "getProfileDiagnostics" | "getParcelDiagnostics"
  >;
  ifsEnsTimeSeries?: Pick<IfsEnsDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
}

export class IfsEnsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly diagnostics: Pick<
    IfsEnsDiagnosticsService,
    "getLayerDiagnostics" | "getProfileDiagnostics" | "getParcelDiagnostics"
  >;
  private readonly timeSeries: Pick<IfsEnsDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;

  constructor(options: IfsEnsDiagnosticAdapterOptions = {}) {
    this.diagnostics = options.ifsEns ?? new IfsEnsDiagnosticsService();
    this.timeSeries = options.ifsEnsTimeSeries ?? new IfsEnsDiagnosticTimeSeriesService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "ifs-ens") {
      throw new Error("IFS ENS diagnostic adapter only accepts dataset=ifs-ens");
    }
    return "at" in request.time ? this.instant(request) : this.range(request);
  }

  private instant(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("at" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected instant");
    }
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
      ...(request.ensemble?.includeMembers === undefined
        ? {}
        : { includeMembers: request.ensemble.includeMembers }),
    };
    if (request.diagnostic.kind === "layer") {
      return this.diagnostics.getLayerDiagnostics({ ...common, ...request.diagnostic } as any);
    }
    if (request.diagnostic.kind === "profile") {
      return this.diagnostics.getProfileDiagnostics({ ...common, ...request.diagnostic } as any);
    }
    return this.diagnostics.getParcelDiagnostics({ ...common, ...request.diagnostic } as any);
  }

  private range(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("from" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected range");
    }
    return this.timeSeries.getDiagnosticTimeSeries(
      ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
        ...diagnosticRangeCommon(request),
        run: request.forecast?.run ?? "latest",
        ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
        ...(request.ensemble?.quantiles === undefined
          ? {}
          : { quantiles: request.ensemble.quantiles }),
      }),
    );
  }
}
