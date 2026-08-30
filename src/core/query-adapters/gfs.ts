import { areaSummaryQuerySchema } from "../../schema/area-summary.js";
import {
  batchPointsQuerySchema,
  pointsTimeSeriesQuerySchema,
  profileQuerySchema,
  timeSeriesQuerySchema,
} from "../../schema/query.js";
import { transectQuerySchema } from "../../schema/transect.js";
import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AreaSummaryService } from "../area-summary.js";
import {
  ArchivedGfsForecastQueryService,
  shouldUseArchivedGfsForecast,
} from "../archived-gfs-query.js";
import { BatchPointsService } from "../batch-points.js";
import { PointsTimeSeriesService } from "../points-time-series.js";
import type { AtmosphericProgressReporter } from "../progress.js";
import { ProfileService } from "../profile.js";
import { TimeSeriesService } from "../time-series.js";
import { TransectService } from "../transect.js";
import { areaScalarSelection, boundingBox, sparseSelection } from "./helpers.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface GfsQueryAdapterOptions {
  gfsProfile?: Pick<ProfileService, "getProfile">;
  gfsTimeSeries?: Pick<TimeSeriesService, "getTimeSeries">;
  gfsPoints?: Pick<BatchPointsService, "getPoints">;
  gfsPointsTimeSeries?: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  gfsTransect?: Pick<TransectService, "getTransect">;
  gfsArea?: Pick<AreaSummaryService, "summarize">;
  archivedGfs?: Pick<ArchivedGfsForecastQueryService, "query">;
  progress?: AtmosphericProgressReporter;
  now?: () => Date;
}

export class GfsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly profile: Pick<ProfileService, "getProfile">;
  private readonly timeSeries: Pick<TimeSeriesService, "getTimeSeries">;
  private readonly points: Pick<BatchPointsService, "getPoints">;
  private readonly pointsTimeSeries: Pick<PointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly transectService: Pick<TransectService, "getTransect">;
  private readonly areaService: Pick<AreaSummaryService, "summarize">;
  private readonly archived: Pick<ArchivedGfsForecastQueryService, "query">;
  private readonly now: () => Date;

  constructor(options: GfsQueryAdapterOptions = {}) {
    this.profile = options.gfsProfile ?? new ProfileService();
    this.timeSeries = options.gfsTimeSeries ?? new TimeSeriesService({
      ...(options.progress === undefined ? {} : { onProgress: options.progress }),
    });
    this.points = options.gfsPoints ?? new BatchPointsService();
    this.pointsTimeSeries = options.gfsPointsTimeSeries ?? new PointsTimeSeriesService({
      ...(options.progress === undefined ? {} : { onProgress: options.progress }),
    });
    this.transectService = options.gfsTransect ?? new TransectService();
    this.areaService = options.gfsArea ?? new AreaSummaryService();
    this.now = options.now ?? (() => new Date());
    this.archived = options.archivedGfs ?? new ArchivedGfsForecastQueryService({ now: this.now });
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs") {
      throw new Error("GFS query adapter only accepts dataset=gfs");
    }
    if (shouldUseArchivedGfsForecast(request, this.now())) {
      return this.archived.query(request);
    }

    switch (request.geometry.type) {
      case "point":
        return "at" in request.time ? this.pointInstant(request) : this.pointRange(request);
      case "points":
        return "at" in request.time ? this.pointsInstant(request) : this.pointsRange(request);
      case "transect":
        return this.transect(request);
      case "area":
        return this.area(request);
    }
  }

  private pointInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal GFS routing error: expected point + instant");
    }
    return this.profile.getProfile(profileQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      validTime: request.time.at,
      ...sparseSelection(request),
      source: request.source ?? "s3",
    }));
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal GFS routing error: expected point + range");
    }
    return this.timeSeries.getTimeSeries(timeSeriesQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      startTime: request.time.from,
      endTime: request.time.to,
      ...sparseSelection(request),
      source: request.source ?? "s3",
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    }));
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal GFS routing error: expected points + instant");
    }
    return this.points.getPoints(batchPointsQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      validTime: request.time.at,
      ...sparseSelection(request),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal GFS routing error: expected points + range");
    }
    return this.pointsTimeSeries.getPointsTimeSeries(pointsTimeSeriesQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      startTime: request.time.from,
      endTime: request.time.to,
      ...sparseSelection(request),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxSamples === undefined ? {} : { maxSamples: request.limits.maxSamples }),
    }));
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal GFS routing error: expected transect + instant");
    }
    return this.transectService.getTransect(transectQuerySchema.parse({
      start: request.geometry.start,
      end: request.geometry.end,
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      validTime: request.time.at,
      ...sparseSelection(request),
      ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
    }));
  }

  private area(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal GFS routing error: expected area + instant");
    }
    return this.areaService.summarize(areaSummaryQuerySchema.parse({
      ...boundingBox(request),
      run: request.forecast?.run ?? "latest",
      grid: request.forecast?.grid ?? "0p25",
      validTime: request.time.at,
      ...areaScalarSelection(request),
      ...(request.aggregate ?? {}),
      ...(request.limits?.maxGridPoints === undefined
        ? {}
        : { maxGridPoints: request.limits.maxGridPoints }),
    }));
  }
}
