import {
  publicDatasetMetadata,
  type DiagnoseAtmosphereRequest,
} from "../../schema/unified-api.js";
import {
  GefsReforecastDiagnosticTimeSeriesService,
  GefsReforecastLayerDiagnosticsService,
  GefsReforecastProfileDiagnosticsService,
} from "../gefs-reforecast-diagnostics.js";
import {
  createGenericDiagnosticServices,
  diagnosticInstantCommon,
  diagnosticRangeCommon,
  runGenericInstantDiagnostic,
  type GenericDiagnosticAdapterOptions,
  type GenericDiagnosticServices,
} from "./helpers.js";
import type { AtmosphericDiagnosticAdapter } from "./types.js";

export interface GefsDiagnosticAdapterOptions extends GenericDiagnosticAdapterOptions {
  gefsReforecastLayer?: Pick<GefsReforecastLayerDiagnosticsService, "getLayerDiagnostics">;
  gefsReforecastProfile?: Pick<GefsReforecastProfileDiagnosticsService, "getProfileDiagnostics">;
  gefsReforecastTimeSeries?: Pick<
    GefsReforecastDiagnosticTimeSeriesService,
    "getDiagnosticTimeSeries"
  >;
}

export class GefsDiagnosticAdapter implements AtmosphericDiagnosticAdapter {
  private readonly generic: GenericDiagnosticServices;
  private readonly reforecastLayer: Pick<GefsReforecastLayerDiagnosticsService, "getLayerDiagnostics">;
  private readonly reforecastProfile: Pick<GefsReforecastProfileDiagnosticsService, "getProfileDiagnostics">;
  private readonly reforecastTimeSeries: Pick<
    GefsReforecastDiagnosticTimeSeriesService,
    "getDiagnosticTimeSeries"
  >;

  constructor(options: GefsDiagnosticAdapterOptions = {}) {
    this.generic = createGenericDiagnosticServices(options);
    this.reforecastLayer =
      options.gefsReforecastLayer ?? new GefsReforecastLayerDiagnosticsService();
    this.reforecastProfile =
      options.gefsReforecastProfile ?? new GefsReforecastProfileDiagnosticsService();
    this.reforecastTimeSeries =
      options.gefsReforecastTimeSeries ?? new GefsReforecastDiagnosticTimeSeriesService();
  }

  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gefs") {
      throw new Error("GEFS diagnostic adapter only accepts dataset=gefs");
    }
    if (request.forecast?.kind === "reforecast") {
      return "at" in request.time
        ? this.reforecastInstant(request)
        : this.reforecastRange(request);
    }

    const model = publicDatasetMetadata("gefs").internalDatasetId;
    if ("at" in request.time) {
      const query = {
        ...diagnosticInstantCommon(request),
        ...request.diagnostic,
        run: request.forecast?.run ?? "latest",
        ...(request.ensemble?.members === undefined
          ? {}
          : { members: request.ensemble.members }),
        ...(request.ensemble?.quantiles === undefined
          ? {}
          : { quantiles: request.ensemble.quantiles }),
        ...(request.ensemble?.includeMembers === undefined
          ? {}
          : { includeMembers: request.ensemble.includeMembers }),
      };
      return runGenericInstantDiagnostic(this.generic, request, model, query);
    }

    return this.generic.timeSeries.getDiagnosticTimeSeries({
      model,
      query: {
        ...diagnosticRangeCommon(request),
        run: request.forecast?.run ?? "latest",
        ...(request.ensemble?.members === undefined
          ? {}
          : { members: request.ensemble.members }),
        ...(request.ensemble?.quantiles === undefined
          ? {}
          : { quantiles: request.ensemble.quantiles }),
      },
    } as any);
  }

  private reforecastInstant(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("at" in request.time) || request.forecast?.kind !== "reforecast") {
      throw new Error("Internal GEFS reforecast routing error: expected instant");
    }
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast.run,
      validTime: request.time.at,
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
      ...(request.ensemble?.includeMembers === undefined
        ? {}
        : { includeMembers: request.ensemble.includeMembers }),
    };
    if (request.diagnostic.kind === "layer") {
      return this.reforecastLayer.getLayerDiagnostics({
        ...common,
        ...request.diagnostic,
      } as any);
    }
    if (request.diagnostic.kind === "profile") {
      return this.reforecastProfile.getProfileDiagnostics({
        ...common,
        ...request.diagnostic,
      } as any);
    }
    throw new Error("Internal routing error: GEFSv12 reforecast parcel diagnostics are unsupported");
  }

  private reforecastRange(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("from" in request.time) || request.forecast?.kind !== "reforecast") {
      throw new Error("Internal GEFS reforecast routing error: expected range");
    }
    return this.reforecastTimeSeries.getDiagnosticTimeSeries({
      ...diagnosticRangeCommon(request),
      run: request.forecast.run,
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined
        ? {}
        : { quantiles: request.ensemble.quantiles }),
    } as any);
  }
}
