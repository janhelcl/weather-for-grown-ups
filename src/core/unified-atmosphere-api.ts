import { operationalGfsModelId } from "../schema/gfs-grid.js";
import { AreaSummaryService } from "./area-summary.js";
import {
  ARCHIVED_GFS_FORECAST_MODEL,
  ArchivedGfsForecastQueryService,
  shouldUseArchivedGfsForecast,
} from "./archived-gfs-query.js";
import { ArchivedGfsForecastDiagnosticService } from "./archived-gfs-diagnostics.js";
import { AtmosphericDiagnosticTimeSeriesService } from "./atmospheric-diagnostic-timeseries-service.js";
import { AtmosphericLayerDiagnosticsService } from "./atmospheric-layer-diagnostics-service.js";
import { AtmosphericParcelDiagnosticsService } from "./atmospheric-parcel-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "./atmospheric-profile-diagnostics-service.js";
import { BatchPointsService } from "./batch-points.js";
import { GefsAreaSummaryService } from "./gefs-area-summary.js";
import { GefsBundleTimeSeriesService } from "./gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "./gefs-member-bundle.js";
import { GefsPointsBundleTimeSeriesService } from "./gefs-points-bundle-timeseries.js";
import { GefsPointsBundleService } from "./gefs-points-bundle.js";
import { GefsTransectService } from "./gefs-transect.js";
import { HistoricalAreaSummaryService } from "./history-area-summary.js";
import { HistoricalFieldsTimeSeriesService } from "./history-fields-timeseries.js";
import { HistoricalFieldsService } from "./history-fields.js";
import { HistoricalPointsTimeSeriesService } from "./history-points-timeseries.js";
import { HistoricalPointsService } from "./history-points.js";
import { HistoricalTimeSeriesService } from "./history-time-series.js";
import { HistoricalTransectService } from "./history-transect.js";
import { HistoricalProfileService } from "./history.js";
import { IfsAreaSummaryService } from "./ifs-area-summary.js";
import { IfsProfileService } from "./ifs-profile.js";
import {
  IfsPointsService,
  IfsPointsTimeSeriesService,
  IfsTimeSeriesService,
  IfsTransectService,
} from "./ifs-spatiotemporal.js";
import { PointsTimeSeriesService } from "./points-time-series.js";
import { ProfileService } from "./profile.js";
import { TimeSeriesService } from "./time-series.js";
import { TransectService } from "./transect.js";
import { areaSummaryQuerySchema } from "../schema/area-summary.js";
import { gefsAreaSummaryQuerySchema } from "../schema/gefs-area-summary.js";
import { gefsBundleTimeSeriesQuerySchema } from "../schema/gefs-bundle-timeseries.js";
import { gefsMemberBundleQuerySchema } from "../schema/gefs-member-bundle.js";
import { gefsPointsBundleTimeSeriesQuerySchema } from "../schema/gefs-points-bundle-timeseries.js";
import { gefsPointsBundleQuerySchema } from "../schema/gefs-points-bundle.js";
import { gefsTransectQuerySchema } from "../schema/gefs-transect.js";
import { historicalAreaSummaryQuerySchema } from "../schema/history-area-summary.js";
import { historicalFieldsTimeSeriesQuerySchema } from "../schema/history-fields-timeseries.js";
import { historicalFieldsQuerySchema } from "../schema/history-fields.js";
import { historicalPointsTimeSeriesQuerySchema } from "../schema/history-points-timeseries.js";
import { historicalPointsQuerySchema } from "../schema/history-points.js";
import { historicalTransectQuerySchema } from "../schema/history-transect.js";
import { historicalProfileQuerySchema, historicalTimeSeriesQuerySchema } from "../schema/history.js";
import { ifsAreaSummaryQuerySchema } from "../schema/ifs-area-summary.js";
import { ifsPointQuerySchema } from "../schema/ifs.js";
import {
  ifsPointsQuerySchema,
  ifsPointsTimeSeriesQuerySchema,
  ifsTimeSeriesQuerySchema,
  ifsTransectQuerySchema,
} from "../schema/ifs-spatiotemporal.js";
import {
  batchPointsQuerySchema,
  pointsTimeSeriesQuerySchema,
  profileQuerySchema,
  timeSeriesQuerySchema,
} from "../schema/query.js";
import { transectQuerySchema } from "../schema/transect.js";
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

export interface UnifiedAtmosphereQueryServiceOptions {
  gfsProfile?: Pick<ProfileService, "getProfile">;
  gfsTimeSeries?: Pick<TimeSeriesService, "getTimeSeries">;
  gfsPoints?: Pick<BatchPointsService, "getPoints">;
  gfsPointsTimeSeries?: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  gfsTransect?: Pick<TransectService, "getTransect">;
  gfsArea?: Pick<AreaSummaryService, "summarize">;
  gefsBundle?: Pick<GefsMemberBundleService, "getBundle">;
  gefsTimeSeries?: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  gefsPoints?: Pick<GefsPointsBundleService, "getPoints">;
  gefsPointsTimeSeries?: Pick<GefsPointsBundleTimeSeriesService, "getPointsTimeSeries">;
  gefsTransect?: Pick<GefsTransectService, "getTransect">;
  gefsArea?: Pick<GefsAreaSummaryService, "summarize">;
  ifsProfile?: Pick<IfsProfileService, "getProfile">;
  ifsTimeSeries?: Pick<IfsTimeSeriesService, "getTimeSeries">;
  ifsPoints?: Pick<IfsPointsService, "getPoints">;
  ifsPointsTimeSeries?: Pick<IfsPointsTimeSeriesService, "getPointsTimeSeries">;
  ifsTransect?: Pick<IfsTransectService, "getTransect">;
  ifsArea?: Pick<IfsAreaSummaryService, "summarize">;
  historyProfile?: Pick<HistoricalProfileService, "getHistoricalProfile">;
  historyFields?: Pick<HistoricalFieldsService, "getHistoricalFields">;
  historyTimeSeries?: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">;
  historyFieldsTimeSeries?: Pick<HistoricalFieldsTimeSeriesService, "getHistoricalFieldsTimeSeries">;
  historyPoints?: Pick<HistoricalPointsService, "getPoints">;
  historyPointsTimeSeries?: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;
  historyTransect?: Pick<HistoricalTransectService, "getTransect">;
  historyArea?: Pick<HistoricalAreaSummaryService, "summarize">;
  archivedGfs?: Pick<ArchivedGfsForecastQueryService, "query">;
  now?: () => Date;
}

export class UnifiedAtmosphereQueryService {
  private readonly gfsProfile: Pick<ProfileService, "getProfile">;
  private readonly gfsTimeSeries: Pick<TimeSeriesService, "getTimeSeries">;
  private readonly gfsPoints: Pick<BatchPointsService, "getPoints">;
  private readonly gfsPointsTimeSeries: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly gfsTransect: Pick<TransectService, "getTransect">;
  private readonly gfsArea: Pick<AreaSummaryService, "summarize">;
  private readonly gefsBundle: Pick<GefsMemberBundleService, "getBundle">;
  private readonly gefsTimeSeries: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  private readonly gefsPoints: Pick<GefsPointsBundleService, "getPoints">;
  private readonly gefsPointsTimeSeries: Pick<GefsPointsBundleTimeSeriesService, "getPointsTimeSeries">;
  private readonly gefsTransect: Pick<GefsTransectService, "getTransect">;
  private readonly gefsArea: Pick<GefsAreaSummaryService, "summarize">;
  private readonly ifsProfile: Pick<IfsProfileService, "getProfile">;
  private readonly ifsTimeSeries: Pick<IfsTimeSeriesService, "getTimeSeries">;
  private readonly ifsPoints: Pick<IfsPointsService, "getPoints">;
  private readonly ifsPointsTimeSeries: Pick<IfsPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly ifsTransect: Pick<IfsTransectService, "getTransect">;
  private readonly ifsArea: Pick<IfsAreaSummaryService, "summarize">;
  private readonly historyProfile: Pick<HistoricalProfileService, "getHistoricalProfile">;
  private readonly historyFields: Pick<HistoricalFieldsService, "getHistoricalFields">;
  private readonly historyTimeSeries: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">;
  private readonly historyFieldsTimeSeries: Pick<HistoricalFieldsTimeSeriesService, "getHistoricalFieldsTimeSeries">;
  private readonly historyPoints: Pick<HistoricalPointsService, "getPoints">;
  private readonly historyPointsTimeSeries: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly historyTransect: Pick<HistoricalTransectService, "getTransect">;
  private readonly historyArea: Pick<HistoricalAreaSummaryService, "summarize">;
  private readonly archivedGfs: Pick<ArchivedGfsForecastQueryService, "query">;
  private readonly now: () => Date;

  constructor(options: UnifiedAtmosphereQueryServiceOptions = {}) {
    this.gfsProfile = options.gfsProfile ?? new ProfileService();
    this.gfsTimeSeries = options.gfsTimeSeries ?? new TimeSeriesService();
    this.gfsPoints = options.gfsPoints ?? new BatchPointsService();
    this.gfsPointsTimeSeries = options.gfsPointsTimeSeries ?? new PointsTimeSeriesService();
    this.gfsTransect = options.gfsTransect ?? new TransectService();
    this.gfsArea = options.gfsArea ?? new AreaSummaryService();
    this.gefsBundle = options.gefsBundle ?? new GefsMemberBundleService();
    this.gefsTimeSeries = options.gefsTimeSeries ?? new GefsBundleTimeSeriesService();
    this.gefsPoints = options.gefsPoints ?? new GefsPointsBundleService();
    this.gefsPointsTimeSeries = options.gefsPointsTimeSeries ?? new GefsPointsBundleTimeSeriesService();
    this.gefsTransect = options.gefsTransect ?? new GefsTransectService();
    this.gefsArea = options.gefsArea ?? new GefsAreaSummaryService();
    this.ifsProfile = options.ifsProfile ?? new IfsProfileService();
    this.ifsTimeSeries = options.ifsTimeSeries ?? new IfsTimeSeriesService();
    this.ifsPoints = options.ifsPoints ?? new IfsPointsService();
    this.ifsPointsTimeSeries = options.ifsPointsTimeSeries ?? new IfsPointsTimeSeriesService();
    this.ifsTransect = options.ifsTransect ?? new IfsTransectService();
    this.ifsArea = options.ifsArea ?? new IfsAreaSummaryService();
    this.historyProfile = options.historyProfile ?? new HistoricalProfileService();
    this.historyFields = options.historyFields ?? new HistoricalFieldsService();
    this.historyTimeSeries = options.historyTimeSeries ?? new HistoricalTimeSeriesService();
    this.historyFieldsTimeSeries = options.historyFieldsTimeSeries ?? new HistoricalFieldsTimeSeriesService();
    this.historyPoints = options.historyPoints ?? new HistoricalPointsService();
    this.historyPointsTimeSeries = options.historyPointsTimeSeries ?? new HistoricalPointsTimeSeriesService();
    this.historyTransect = options.historyTransect ?? new HistoricalTransectService();
    this.historyArea = options.historyArea ?? new HistoricalAreaSummaryService();
    this.now = options.now ?? (() => new Date());
    this.archivedGfs = options.archivedGfs ?? new ArchivedGfsForecastQueryService({ now: this.now });
  }

  async query(input: QueryAtmosphereInput): Promise<UnifiedAtmosphereResult> {
    const request = queryAtmosphereSchema.parse(input);
    const result = await this.route(request);
    return wrapResult(request, result);
  }

  private route(request: QueryAtmosphereRequest): Promise<unknown> {
    if (shouldUseArchivedGfsForecast(request, this.now())) {
      return this.archivedGfs.query(request);
    }
    switch (request.geometry.type) {
      case "point":
        return "at" in request.time
          ? this.pointInstant(request)
          : this.pointRange(request);
      case "points":
        return "at" in request.time
          ? this.pointsInstant(request)
          : this.pointsRange(request);
      case "transect":
        return this.transect(request);
      case "area":
        return this.area(request);
    }
  }

  private pointInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal routing error: expected point + instant");
    }
    const point = { latitude: request.geometry.latitude, longitude: request.geometry.longitude };
    const run = request.forecast?.run ?? "latest";

    if (request.dataset === "gfs") {
      const query = profileQuerySchema.parse({
        ...point,
        run,
        grid: request.forecast?.grid ?? "0p25",
        validTime: request.time.at,
        ...gfsSelection(request),
        ...(request.source === undefined ? {} : { source: request.source }),
      });
      return this.gfsProfile.getProfile(query);
    }

    if (request.dataset === "gefs") {
      const query = gefsMemberBundleQuerySchema.parse({
        ...point,
        run,
        grid: request.forecast?.grid ?? "0p25",
        validTime: request.time.at,
        selection: gefsSelection(request),
        ...ensembleOptions(request),
      });
      return this.gefsBundle.getBundle(query);
    }

    if (request.dataset === "ifs") {
      return this.ifsProfile.getProfile(ifsPointQuerySchema.parse({
        ...point,
        run,
        validTime: request.time.at,
        ...gfsSelection(request),
      }));
    }

    if ((request.selection.fields?.length ?? 0) > 0) {
      const query = historicalFieldsQuerySchema.parse({
        ...point,
        analysisTime: request.time.at,
        ...historySelection(request),
      });
      return this.historyFields.getHistoricalFields(query);
    }

    const query = historicalProfileQuerySchema.parse({
      ...point,
      analysisTime: request.time.at,
      variables: request.selection.variables,
      pressureLevelsHpa: request.selection.pressureLevelsHpa,
    });
    return this.historyProfile.getHistoricalProfile(query);
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal routing error: expected point + range");
    }
    const point = { latitude: request.geometry.latitude, longitude: request.geometry.longitude };
    const run = request.forecast?.run ?? "latest";

    if (request.dataset === "gfs") {
      const query = timeSeriesQuerySchema.parse({
        ...point,
        run,
        grid: request.forecast?.grid ?? "0p25",
        startTime: request.time.from,
        endTime: request.time.to,
        ...gfsSelection(request),
        ...(request.source === undefined ? {} : { source: request.source }),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      });
      return this.gfsTimeSeries.getTimeSeries(query);
    }

    if (request.dataset === "gefs") {
      const query = gefsBundleTimeSeriesQuerySchema.parse({
        ...point,
        run,
        grid: request.forecast?.grid ?? "0p25",
        startTime: request.time.from,
        endTime: request.time.to,
        selection: gefsSelection(request),
        ...ensembleOptions(request),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      });
      return this.gefsTimeSeries.getTimeSeries(query);
    }

    if (request.dataset === "ifs") {
      return this.ifsTimeSeries.getTimeSeries(ifsTimeSeriesQuerySchema.parse({
        ...point,
        run,
        startTime: request.time.from,
        endTime: request.time.to,
        ...gfsSelection(request),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      }));
    }

    const historyRange = {
      ...point,
      startTime: request.time.from,
      endTime: request.time.to,
      ...(request.time.hoursUtc === undefined ? {} : { cycleHoursUtc: request.time.hoursUtc }),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    };

    if ((request.selection.fields?.length ?? 0) > 0) {
      const query = historicalFieldsTimeSeriesQuerySchema.parse({
        ...historyRange,
        ...historySelection(request),
      });
      return this.historyFieldsTimeSeries.getHistoricalFieldsTimeSeries(query);
    }

    const query = historicalTimeSeriesQuerySchema.parse({
      ...historyRange,
      variables: request.selection.variables,
      pressureLevelsHpa: request.selection.pressureLevelsHpa,
    });
    return this.historyTimeSeries.getHistoricalTimeSeries(query);
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal routing error: expected points + instant");
    }
    const run = request.forecast?.run ?? "latest";

    if (request.dataset === "gfs") {
      return this.gfsPoints.getPoints(batchPointsQuerySchema.parse({
        points: request.geometry.points,
        run,
        grid: request.forecast?.grid ?? "0p25",
        validTime: request.time.at,
        ...gfsSelection(request),
      }));
    }
    if (request.dataset === "gefs") {
      return this.gefsPoints.getPoints(gefsPointsBundleQuerySchema.parse({
        points: request.geometry.points,
        run,
        validTime: request.time.at,
        selection: gefsSelection(request),
        ...ensembleOptions(request),
        ...(request.ensemble?.maxMemberSamples === undefined
          ? {}
          : { maxMemberSamples: request.ensemble.maxMemberSamples }),
      }));
    }
    if (request.dataset === "ifs") {
      return this.ifsPoints.getPoints(ifsPointsQuerySchema.parse({
        points: request.geometry.points,
        run,
        validTime: request.time.at,
        ...gfsSelection(request),
      }));
    }
    return this.historyPoints.getPoints(historicalPointsQuerySchema.parse({
      points: request.geometry.points,
      analysisTime: request.time.at,
      ...historySelection(request),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal routing error: expected points + range");
    }
    const run = request.forecast?.run ?? "latest";

    if (request.dataset === "gfs") {
      return this.gfsPointsTimeSeries.getPointsTimeSeries(pointsTimeSeriesQuerySchema.parse({
        points: request.geometry.points,
        run,
        grid: request.forecast?.grid ?? "0p25",
        startTime: request.time.from,
        endTime: request.time.to,
        ...gfsSelection(request),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
        ...(request.limits?.maxSamples === undefined ? {} : { maxSamples: request.limits.maxSamples }),
      }));
    }
    if (request.dataset === "gefs") {
      return this.gefsPointsTimeSeries.getPointsTimeSeries(gefsPointsBundleTimeSeriesQuerySchema.parse({
        points: request.geometry.points,
        run,
        startTime: request.time.from,
        endTime: request.time.to,
        selection: gefsSelection(request),
        ...ensembleOptions(request),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
        ...(request.limits?.maxPointSteps === undefined ? {} : { maxPointSteps: request.limits.maxPointSteps }),
        ...(request.ensemble?.maxMemberSamples === undefined
          ? {}
          : { maxMemberSamples: request.ensemble.maxMemberSamples }),
      }));
    }
    if (request.dataset === "ifs") {
      return this.ifsPointsTimeSeries.getPointsTimeSeries(ifsPointsTimeSeriesQuerySchema.parse({
        points: request.geometry.points,
        run,
        startTime: request.time.from,
        endTime: request.time.to,
        ...gfsSelection(request),
        ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
        ...(request.limits?.maxPointSteps === undefined ? {} : { maxPointSteps: request.limits.maxPointSteps }),
      }));
    }
    return this.historyPointsTimeSeries.getPointsTimeSeries(historicalPointsTimeSeriesQuerySchema.parse({
      points: request.geometry.points,
      startTime: request.time.from,
      endTime: request.time.to,
      ...historySelection(request),
      ...(request.time.hoursUtc === undefined ? {} : { cycleHoursUtc: request.time.hoursUtc }),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxPointSteps === undefined ? {} : { maxPointSteps: request.limits.maxPointSteps }),
    }));
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal routing error: expected transect + instant");
    }
    const run = request.forecast?.run ?? "latest";

    if (request.dataset === "gfs") {
      if ((request.selection.fields?.length ?? 0) > 0) {
        throw new Error("Operational GFS transects currently support pressure-level variables only; remove fields or use point/points geometry");
      }
      return this.gfsTransect.getTransect(transectQuerySchema.parse({
        start: request.geometry.start,
        end: request.geometry.end,
        run,
        grid: request.forecast?.grid ?? "0p25",
        validTime: request.time.at,
        variables: request.selection.variables,
        pressureLevelsHpa: request.selection.pressureLevelsHpa,
        ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
      }));
    }
    if (request.dataset === "gefs") {
      return this.gefsTransect.getTransect(gefsTransectQuerySchema.parse({
        start: request.geometry.start,
        end: request.geometry.end,
        run,
        validTime: request.time.at,
        selection: gefsSelection(request),
        ...ensembleOptions(request),
        ...(request.ensemble?.maxMemberSamples === undefined
          ? {}
          : { maxMemberSamples: request.ensemble.maxMemberSamples }),
        ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
      }));
    }
    if (request.dataset === "ifs") {
      return this.ifsTransect.getTransect(ifsTransectQuerySchema.parse({
        start: request.geometry.start,
        end: request.geometry.end,
        run,
        validTime: request.time.at,
        ...gfsSelection(request),
        ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
      }));
    }
    return this.historyTransect.getTransect(historicalTransectQuerySchema.parse({
      start: request.geometry.start,
      end: request.geometry.end,
      analysisTime: request.time.at,
      ...historySelection(request),
      ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
    }));
  }

  private area(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal routing error: expected area + instant");
    }
    const run = request.forecast?.run ?? "latest";
    const scalar = areaScalarSelection(request);
    const bbox = {
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
    };
    const aggregate = request.aggregate ?? {};

    if (request.dataset === "gfs") {
      return this.gfsArea.summarize(areaSummaryQuerySchema.parse({
        ...bbox,
        run,
        grid: request.forecast?.grid ?? "0p25",
        validTime: request.time.at,
        ...scalar,
        ...aggregate,
        ...(request.limits?.maxGridPoints === undefined ? {} : { maxGridPoints: request.limits.maxGridPoints }),
      }));
    }
    if (request.dataset === "gefs") {
      return this.gefsArea.summarize(gefsAreaSummaryQuerySchema.parse({
        ...bbox,
        run,
        validTime: request.time.at,
        ...scalar,
        ...aggregate,
        ...ensembleOptions(request),
        ...(request.limits?.maxGridPoints === undefined ? {} : { maxGridPoints: request.limits.maxGridPoints }),
        ...(request.limits?.maxMemberGridPoints === undefined
          ? {}
          : { maxMemberGridPoints: request.limits.maxMemberGridPoints }),
      }));
    }
    if (request.dataset === "ifs") {
      return this.ifsArea.summarize(ifsAreaSummaryQuerySchema.parse({
        ...bbox,
        run,
        validTime: request.time.at,
        ...scalar,
        ...aggregate,
        ...(request.limits?.maxGridPoints === undefined ? {} : { maxGridPoints: request.limits.maxGridPoints }),
      }));
    }
    return this.historyArea.summarize(historicalAreaSummaryQuerySchema.parse({
      ...bbox,
      analysisTime: request.time.at,
      ...scalar,
      ...aggregate,
      ...(request.limits?.maxGridPoints === undefined ? {} : { maxGridPoints: request.limits.maxGridPoints }),
    }));
  }
}

export interface UnifiedAtmosphereDiagnosticServiceOptions {
  layer?: AtmosphericLayerDiagnosticsService;
  profile?: AtmosphericProfileDiagnosticsService;
  parcel?: AtmosphericParcelDiagnosticsService;
  timeSeries?: AtmosphericDiagnosticTimeSeriesService;
  archivedGfs?: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  now?: () => Date;
}

export class UnifiedAtmosphereDiagnosticService {
  private readonly layer: AtmosphericLayerDiagnosticsService;
  private readonly profile: AtmosphericProfileDiagnosticsService;
  private readonly parcel: AtmosphericParcelDiagnosticsService;
  private readonly timeSeries: AtmosphericDiagnosticTimeSeriesService;
  private readonly archivedGfs: Pick<ArchivedGfsForecastDiagnosticService, "diagnose">;
  private readonly now: () => Date;

  constructor(options: UnifiedAtmosphereDiagnosticServiceOptions = {}) {
    this.layer = options.layer ?? new AtmosphericLayerDiagnosticsService();
    this.profile = options.profile ?? new AtmosphericProfileDiagnosticsService();
    this.parcel = options.parcel ?? new AtmosphericParcelDiagnosticsService();
    this.timeSeries = options.timeSeries ?? new AtmosphericDiagnosticTimeSeriesService();
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

    if (request.dataset === "gfs") {
      return this.timeSeries.getDiagnosticTimeSeries({
        model,
        query: {
          ...common,
          run: request.forecast?.run ?? "latest",
          grid: request.forecast?.grid ?? "0p25",
          ...(request.source === undefined ? {} : { source: request.source }),
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

function gfsSelection(request: QueryAtmosphereRequest) {
  return {
    ...(request.selection.variables === undefined ? {} : { variables: request.selection.variables }),
    ...(request.selection.pressureLevelsHpa === undefined
      ? {}
      : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
    ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
  };
}

function gefsSelection(request: QueryAtmosphereRequest) {
  return {
    variables: request.selection.variables ?? [],
    pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
    fields: request.selection.fields ?? [],
  };
}

function historySelection(request: QueryAtmosphereRequest) {
  return {
    ...(request.selection.variables === undefined ? {} : { variables: request.selection.variables }),
    ...(request.selection.pressureLevelsHpa === undefined
      ? {}
      : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
    ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
  };
}

function ensembleOptions(request: QueryAtmosphereRequest) {
  return {
    ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
    ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
    ...(request.ensemble?.includeMembers === undefined
      ? {}
      : { includeMembers: request.ensemble.includeMembers }),
  };
}

function areaScalarSelection(request: QueryAtmosphereRequest) {
  if ((request.selection.fields?.length ?? 0) === 1) {
    return { field: request.selection.fields![0] };
  }
  return {
    variable: request.selection.variables![0],
    pressureLevelHpa: request.selection.pressureLevelsHpa![0],
  };
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
      ...(request.source === undefined ? {} : { source: request.source }),
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
  const internalDatasetId = isArchivedGfsForecastResult(result)
    ? (result as { model: "gfs_0p25_forecast_archive" | "gfs_grid4_forecast_0p5_archive" }).model
    : isOperationalGfsResult(result)
      ? (result as { model: "gfs_0p25" | "gfs_0p50" }).model
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
