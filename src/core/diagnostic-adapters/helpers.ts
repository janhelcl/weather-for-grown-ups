import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AtmosphericDiagnosticTimeSeriesService } from "../atmospheric-diagnostic-timeseries-service.js";
import { AtmosphericLayerDiagnosticsService } from "../atmospheric-layer-diagnostics-service.js";
import { AtmosphericParcelDiagnosticsService } from "../atmospheric-parcel-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "../atmospheric-profile-diagnostics-service.js";

export interface GenericDiagnosticAdapterOptions {
  layer?: Pick<AtmosphericLayerDiagnosticsService, "getLayerDiagnostics">;
  profile?: Pick<AtmosphericProfileDiagnosticsService, "getProfileDiagnostics">;
  parcel?: Pick<AtmosphericParcelDiagnosticsService, "getParcelDiagnostics">;
  timeSeries?: Pick<AtmosphericDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
}

export interface GenericDiagnosticServices {
  layer: Pick<AtmosphericLayerDiagnosticsService, "getLayerDiagnostics">;
  profile: Pick<AtmosphericProfileDiagnosticsService, "getProfileDiagnostics">;
  parcel: Pick<AtmosphericParcelDiagnosticsService, "getParcelDiagnostics">;
  timeSeries: Pick<AtmosphericDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
}

export function createGenericDiagnosticServices(
  options: GenericDiagnosticAdapterOptions,
): GenericDiagnosticServices {
  return {
    layer: options.layer ?? new AtmosphericLayerDiagnosticsService(),
    profile: options.profile ?? new AtmosphericProfileDiagnosticsService(),
    parcel: options.parcel ?? new AtmosphericParcelDiagnosticsService(),
    timeSeries: options.timeSeries ?? new AtmosphericDiagnosticTimeSeriesService(),
  };
}

export function runGenericInstantDiagnostic(
  services: GenericDiagnosticServices,
  request: DiagnoseAtmosphereRequest,
  model: string,
  query: Record<string, unknown>,
): Promise<unknown> {
  if (request.diagnostic.kind === "layer") {
    return services.layer.getLayerDiagnostics({ model, query } as any);
  }
  if (request.diagnostic.kind === "profile") {
    return services.profile.getProfileDiagnostics({ model, query } as any);
  }
  return services.parcel.getParcelDiagnostics({ model, query } as any);
}

export function diagnosticRangeCommon(request: DiagnoseAtmosphereRequest) {
  if (!("from" in request.time)) {
    throw new Error("Internal routing error: expected diagnostic range");
  }
  return {
    latitude: request.geometry.latitude,
    longitude: request.geometry.longitude,
    startTime: request.time.from,
    endTime: request.time.to,
    diagnostic: request.diagnostic,
    ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
  };
}

export function diagnosticInstantCommon(request: DiagnoseAtmosphereRequest) {
  if (!("at" in request.time)) {
    throw new Error("Internal routing error: expected instant diagnostic");
  }
  return {
    latitude: request.geometry.latitude,
    longitude: request.geometry.longitude,
    validTime: request.time.at,
  };
}
