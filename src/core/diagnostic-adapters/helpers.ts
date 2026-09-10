import type { DiagnoseAtmosphereRequest } from "../../schema/unified-api.js";
import { AtmosphericDiagnosticTimeSeriesService } from "../atmospheric-diagnostic-timeseries-service.js";
import { AtmosphericLayerDiagnosticsService } from "../atmospheric-layer-diagnostics-service.js";
import { AtmosphericParcelDiagnosticsService } from "../atmospheric-parcel-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "../atmospheric-profile-diagnostics-service.js";
import { DiagnosticTimeSeriesService } from "../diagnostic-time-series.js";
import { IfsDiagnosticTimeSeriesService } from "../ifs-diagnostic-timeseries.js";
import { IfsDiagnosticsService } from "../ifs-diagnostics.js";
import { LayerDiagnosticsService } from "../layer-diagnostics.js";
import { ParcelDiagnosticsService } from "../parcel-diagnostics.js";
import { ProfileDiagnosticsService } from "../profile-diagnostics.js";
import {
  GfsProfileEvidenceService,
  IfsProfileEvidenceService,
} from "../profile-evidence-service.js";

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
  const defaults = createEvidenceAwareDiagnosticServices();
  return {
    layer: options.layer ?? defaults.layer,
    profile: options.profile ?? defaults.profile,
    parcel: options.parcel ?? defaults.parcel,
    timeSeries: options.timeSeries ?? defaults.timeSeries,
  };
}

/**
 * Build the shared diagnostic families over the same persistent profile
 * evidence boundary used by normal GFS/IFS queries. The atmospheric wrappers
 * still own model dispatch; only acquisition/materialization is shared.
 */
function createEvidenceAwareDiagnosticServices(): GenericDiagnosticServices {
  const gfsProfile = new GfsProfileEvidenceService();
  const gfsLayer = new LayerDiagnosticsService({ profileGetter: gfsProfile });
  const gfsProfileDiagnostics = new ProfileDiagnosticsService({ profileGetter: gfsProfile });
  const gfsParcel = new ParcelDiagnosticsService({ profileGetter: gfsProfile });

  const ifsProfile = new IfsProfileEvidenceService();
  const ifsDiagnostics = new IfsDiagnosticsService({ profileGetter: ifsProfile });

  return {
    layer: new AtmosphericLayerDiagnosticsService({
      gfs: gfsLayer,
      ifs: ifsDiagnostics,
    }),
    profile: new AtmosphericProfileDiagnosticsService({
      gfs: gfsProfileDiagnostics,
      ifs: ifsDiagnostics,
    }),
    parcel: new AtmosphericParcelDiagnosticsService({
      gfs: gfsParcel,
      ifs: ifsDiagnostics,
    }),
    timeSeries: new AtmosphericDiagnosticTimeSeriesService({
      gfs: new DiagnosticTimeSeriesService({
        layerDiagnosticsGetter: gfsLayer,
        profileDiagnosticsGetter: gfsProfileDiagnostics,
        parcelDiagnosticsGetter: gfsParcel,
      }),
      ifs: new IfsDiagnosticTimeSeriesService({ diagnostics: ifsDiagnostics }),
    }),
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
