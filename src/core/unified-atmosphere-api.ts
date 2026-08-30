import { operationalGfsModelId } from "../schema/gfs-grid.js";
import {
  ARCHIVED_GFS_FORECAST_MODEL,
  shouldUseArchivedGfsForecast,
} from "./archived-gfs-query.js";
import { ArchivedGfsForecastDiagnosticService } from "./archived-gfs-diagnostics.js";
import { AtmosphericDiagnosticTimeSeriesService } from "./atmospheric-diagnostic-timeseries-service.js";
import { AtmosphericLayerDiagnosticsService } from "./atmospheric-layer-diagnostics-service.js";
import { AtmosphericParcelDiagnosticsService } from "./atmospheric-parcel-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "./atmospheric-profile-diagnostics-service.js";
import {
  GefsReforecastDiagnosticTimeSeriesService,
  GefsReforecastLayerDiagnosticsService,
  GefsReforecastProfileDiagnosticsService,
} from "./gefs-reforecast-diagnostics.js";
import { IfsEnsDiagnosticTimeSeriesService } from "./ifs-ens-diagnostic-timeseries.js";
import { IfsEnsDiagnosticsService } from "./ifs-ens-diagnostics.js";
import {
  createAtmosphericQueryAdapterRegistry,
  type AtmosphericQueryRegistryOptions,
} from "./query-adapters/registry.js";
import type { AtmosphericQueryAdapterRegistry } from "./query-adapters/types.js";
import { ifsEnsDiagnosticTimeSeriesQuerySchema } from "../schema/ifs-ens-diagnostic-timeseries.js";
import {
  diagnoseAtmosphereSchema,
  publicDatasetMetadata,
  queryAtmosphereSchema,
  unifiedAtmosphereResultSchema,
  type DiagnoseAtmosphereInput,
  type DiagnoseAtmosphereRequest,
  type QueryAtmosphereInput,
  type QueryAtmosphereRequest,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";

export interface UnifiedAtmosphereQueryServiceOptions extends AtmosphericQueryRegistryOptions {}

export class UnifiedAtmosphereQueryService {
  private readonly adapters: AtmosphericQueryAdapterRegistry;

  constructor(options: UnifiedAtmosphereQueryServiceOptions = {}) {
    this.adapters = createAtmosphericQueryAdapterRegistry(options);
  }

  async query(input: QueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = queryAtmosphereSchema.parse(input);
    const result = await this.adapters[request.dataset].query(request);
    return wrapResult(request, result);
  }
}

export interface UnifiedAtmosphereDiagnosticServiceOptions {
  layer?: AtmosphericLayerDiagnosticsService;
  profile?: AtmosphericProfileDiagnosticsService;
  parcel?: AtmosphericParcelDiagnosticsService;
  timeSeries?: AtmosphericDiagnosticTimeSeriesService;
  ifsEns?: Pick<
    IfsEnsDiagnosticsService,
    "getLayerDiagnostics" | "getProfileDiagnostics" | "getParcelDiagnostics"
  >;
  ifsEnsTimeSeries?: Pick<IfsEnsDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
  gefsReforecastLayer?: Pick<GefsReforecastLayerDiagnosticsService, "getLayerDiagnostics">;
  gefsReforecastProfile?: Pick<GefsReforecastProfileDiagnosticsService, "getProfileDiagnostics">;
  gefsReforecastTimeSeries?: Pick<GefsReforecastDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
  archivedGfs?: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  now?: () => Date;
}

export class UnifiedAtmosphereDiagnosticService {
  private readonly layer: AtmosphericLayerDiagnosticsService;
  private readonly profile: AtmosphericProfileDiagnosticsService;
  private readonly parcel: AtmosphericParcelDiagnosticsService;
  private readonly timeSeries: AtmosphericDiagnosticTimeSeriesService;
  private readonly ifsEns: Pick<
    IfsEnsDiagnosticsService,
    "getLayerDiagnostics" | "getProfileDiagnostics" | "getParcelDiagnostics"
  >;
  private readonly ifsEnsTimeSeries: Pick<IfsEnsDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
  private readonly gefsReforecastLayer: Pick<GefsReforecastLayerDiagnosticsService, "getLayerDiagnostics">;
  private readonly gefsReforecastProfile: Pick<GefsReforecastProfileDiagnosticsService, "getProfileDiagnostics">;
  private readonly gefsReforecastTimeSeries: Pick<GefsReforecastDiagnosticTimeSeriesService, "getDiagnosticTimeSeries">;
  private readonly archivedGfs: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  private readonly now: () => Date;

  constructor(options: UnifiedAtmosphereDiagnosticServiceOptions = {}) {
    this.layer = options.layer ?? new AtmosphericLayerDiagnosticsService();
    this.profile = options.profile ?? new AtmosphericProfileDiagnosticsService();
    this.parcel = options.parcel ?? new AtmosphericParcelDiagnosticsService();
    this.timeSeries = options.timeSeries ?? new AtmosphericDiagnosticTimeSeriesService();
    this.ifsEns = options.ifsEns ?? new IfsEnsDiagnosticsService();
    this.ifsEnsTimeSeries = options.ifsEnsTimeSeries ?? new IfsEnsDiagnosticTimeSeriesService();
    this.gefsReforecastLayer =
      options.gefsReforecastLayer ?? new GefsReforecastLayerDiagnosticsService();
    this.gefsReforecastProfile =
      options.gefsReforecastProfile ?? new GefsReforecastProfileDiagnosticsService();
    this.gefsReforecastTimeSeries =
      options.gefsReforecastTimeSeries ?? new GefsReforecastDiagnosticTimeSeriesService();
    this.archivedGfs = options.archivedGfs ?? new ArchivedGfsForecastDiagnosticService();
    this.now = options.now ?? (() => new Date());
  }

  async diagnose(input: DiagnoseAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = diagnoseAtmosphereSchema.parse(input);
    const result = shouldUseArchivedGfsForecast(request, this.now())
      ? await this.archivedGfs.diagnose(request)
      : "at" in request.time
        ? await this.instant(request)
        : await this.range(request);
    return wrapResult(request, result);
  }

  private instant(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("at" in request.time)) throw new Error("Internal routing error: expected instant diagnostic");
    if (request.dataset === "gefs" && request.forecast?.kind === "reforecast") {
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
        return this.gefsReforecastLayer.getLayerDiagnostics({
          ...common,
          ...request.diagnostic,
        } as any);
      }
      if (request.diagnostic.kind === "profile") {
        return this.gefsReforecastProfile.getProfileDiagnostics({
          ...common,
          ...request.diagnostic,
        } as any);
      }
      throw new Error("Internal routing error: GEFSv12 reforecast parcel diagnostics are unsupported");
    }
    if (request.dataset === "ifs-ens") {
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
        return this.ifsEns.getLayerDiagnostics({ ...common, ...request.diagnostic } as any);
      }
      if (request.diagnostic.kind === "profile") {
        return this.ifsEns.getProfileDiagnostics({ ...common, ...request.diagnostic } as any);
      }
      return this.ifsEns.getParcelDiagnostics({ ...common, ...request.diagnostic } as any);
    }
    const common = instantDiagnosticCommon(request);
    const model = request.dataset === "gfs"
      ? operationalGfsModelId(request.forecast?.grid ?? "0p25")
      : publicDatasetMetadata(request.dataset).internalDatasetId;

    if (request.diagnostic.kind === "layer") {
      return this.layer.getLayerDiagnostics({
        model,
        query: datasetDiagnosticQuery(request, { ...common, ...request.diagnostic }),
      } as any);
    }
    if (request.diagnostic.kind === "profile") {
      return this.profile.getProfileDiagnostics({
        model,
        query: datasetDiagnosticQuery(request, { ...common, ...request.diagnostic }),
      } as any);
    }
    return this.parcel.getParcelDiagnostics({
      model,
      query: datasetDiagnosticQuery(request, { ...common, ...request.diagnostic }),
    } as any);
  }

  private range(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (!("from" in request.time)) throw new Error("Internal routing error: expected diagnostic range");
    const model = request.dataset === "gfs"
      ? operationalGfsModelId(request.forecast?.grid ?? "0p25")
      : publicDatasetMetadata(request.dataset).internalDatasetId;
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      startTime: request.time.from,
      endTime: request.time.to,
      diagnostic: request.diagnostic,
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    };

    if (request.dataset === "gefs" && request.forecast?.kind === "reforecast") {
      return this.gefsReforecastTimeSeries.getDiagnosticTimeSeries({
        ...common,
        run: request.forecast.run,
        ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
        ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
      } as any);
    }

    if (request.dataset === "ifs-ens") {
      return this.ifsEnsTimeSeries.getDiagnosticTimeSeries(
        ifsEnsDiagnosticTimeSeriesQuerySchema.parse({
          ...common,
          run: request.forecast?.run ?? "latest",
          ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
          ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
        }),
      );
    }

    if (request.dataset === "gfs") {
      return this.timeSeries.getDiagnosticTimeSeries({
        model,
        query: {
          ...common,
          run: request.forecast?.run ?? "latest",
          grid: request.forecast?.grid ?? "0p25",
          source: request.source ?? "s3",
        },
      } as any);
    }
    if (request.dataset === "gefs") {
      return this.timeSeries.getDiagnosticTimeSeries({
        model,
        query: {
          ...common,
          run: request.forecast?.run ?? "latest",
          ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
          ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
        },
      } as any);
    }
    if (request.dataset === "ifs") {
      return this.timeSeries.getDiagnosticTimeSeries({
        model,
        query: {
          ...common,
          run: request.forecast?.run ?? "latest",
        },
      } as any);
    }
    return this.timeSeries.getDiagnosticTimeSeries({
      model,
      query: {
        ...common,
        ...(request.time.hoursUtc === undefined ? {} : { cycleHoursUtc: request.time.hoursUtc }),
      },
    } as any);
  }
}

function instantDiagnosticCommon(request: DiagnoseAtmosphereRequest) {
  if (!("at" in request.time)) throw new Error("Internal routing error: expected instant");
  return {
    latitude: request.geometry.latitude,
    longitude: request.geometry.longitude,
    validTime: request.time.at,
  };
}

function datasetDiagnosticQuery(request: DiagnoseAtmosphereRequest, common: Record<string, unknown>) {
  if (!("at" in request.time)) throw new Error("Internal routing error: expected instant");
  if (request.dataset === "gfs") {
    return {
      ...common,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      source: request.source ?? "s3",
    };
  }
  if (request.dataset === "gefs") {
    return {
      ...common,
      run: request.forecast?.run ?? "latest",
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
      ...(request.ensemble?.includeMembers === undefined
        ? {}
        : { includeMembers: request.ensemble.includeMembers }),
    };
  }
  if (request.dataset === "ifs") {
    return {
      ...common,
      run: request.forecast?.run ?? "latest",
    };
  }
  const { validTime, ...rest } = common;
  return {
    ...rest,
    analysisTime: validTime,
  };
}

function wrapResult(
  request: QueryAtmosphereRequest | DiagnoseAtmosphereRequest,
  result: unknown,
): UnifiedAtmosphereResult {
  const metadata = publicDatasetMetadata(request.dataset);
  const internalDatasetId = request.forecast?.kind === "reforecast"
    ? "gefs_v12_reforecast"
    : isArchivedGfsForecastResult(result)
      ? (result as { model: "gfs_0p25_forecast_archive" | "gfs_grid4_forecast_0p5_archive" }).model
      : isOperationalGfsResult(result)
        ? (result as { model: "gfs_0p25" | "gfs_0p50" }).model
        : isGefsReforecastResult(result)
          ? "gefs_v12_reforecast"
          : metadata.internalDatasetId;
  return unifiedAtmosphereResultSchema.parse({
    dataset: request.dataset,
    internalDatasetId,
    role: metadata.role,
    kind: metadata.kind,
    geometryType: request.geometry.type,
    timeType: "at" in request.time ? "instant" : "range",
    result,
  });
}


function isOperationalGfsResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && ((result as { model?: unknown }).model === "gfs_0p25"
      || (result as { model?: unknown }).model === "gfs_0p50");
}

function isArchivedGfsForecastResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && (
      (result as { model?: unknown }).model === ARCHIVED_GFS_FORECAST_MODEL
      || (result as { model?: unknown }).model === "gfs_0p25_forecast_archive"
    );
}

function isGefsReforecastResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "model" in result
    && (result as { model?: unknown }).model === "gefs_v12_reforecast";
}
