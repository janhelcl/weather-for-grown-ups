import { historicalAreaSummaryQuerySchema } from "../../schema/history-area-summary.js";
import { historicalFieldsTimeSeriesQuerySchema } from "../../schema/history-fields-timeseries.js";
import { historicalFieldsQuerySchema } from "../../schema/history-fields.js";
import { historicalPointsTimeSeriesQuerySchema } from "../../schema/history-points-timeseries.js";
import { historicalPointsQuerySchema } from "../../schema/history-points.js";
import { historicalTransectQuerySchema } from "../../schema/history-transect.js";
import {
  historicalProfileQuerySchema,
  historicalTimeSeriesQuerySchema,
} from "../../schema/history.js";
import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { HistoricalAreaSummaryService } from "../history-area-summary.js";
import { HistoricalFieldsTimeSeriesService } from "../history-fields-timeseries.js";
import { HistoricalFieldsService } from "../history-fields.js";
import { HistoricalPointsTimeSeriesService } from "../history-points-timeseries.js";
import { HistoricalPointsService } from "../history-points.js";
import { HistoricalTimeSeriesService } from "../history-time-series.js";
import { HistoricalTransectService } from "../history-transect.js";
import { HistoricalProfileService } from "../history.js";
import { areaScalarSelection, boundingBox, sparseSelection } from "./helpers.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface GfsAnalysisQueryAdapterOptions {
  historyProfile?: Pick<HistoricalProfileService, "getHistoricalProfile">;
  historyFields?: Pick<HistoricalFieldsService, "getHistoricalFields">;
  historyTimeSeries?: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">;
  historyFieldsTimeSeries?: Pick<
    HistoricalFieldsTimeSeriesService,
    "getHistoricalFieldsTimeSeries"
  >;
  historyPoints?: Pick<HistoricalPointsService, "getPoints">;
  historyPointsTimeSeries?: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;
  historyTransect?: Pick<HistoricalTransectService, "getTransect">;
  historyArea?: Pick<HistoricalAreaSummaryService, "summarize">;
}

export class GfsAnalysisQueryAdapter implements AtmosphericQueryAdapter {
  private readonly profile: Pick<HistoricalProfileService, "getHistoricalProfile">;
  private readonly fields: Pick<HistoricalFieldsService, "getHistoricalFields">;
  private readonly timeSeries: Pick<HistoricalTimeSeriesService, "getHistoricalTimeSeries">;
  private readonly fieldsTimeSeries: Pick<
    HistoricalFieldsTimeSeriesService,
    "getHistoricalFieldsTimeSeries"
  >;
  private readonly points: Pick<HistoricalPointsService, "getPoints">;
  private readonly pointsTimeSeries: Pick<HistoricalPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly transectService: Pick<HistoricalTransectService, "getTransect">;
  private readonly areaService: Pick<HistoricalAreaSummaryService, "summarize">;

  constructor(options: GfsAnalysisQueryAdapterOptions = {}) {
    this.profile = options.historyProfile ?? new HistoricalProfileService();
    this.fields = options.historyFields ?? new HistoricalFieldsService();
    this.timeSeries = options.historyTimeSeries ?? new HistoricalTimeSeriesService();
    this.fieldsTimeSeries =
      options.historyFieldsTimeSeries ?? new HistoricalFieldsTimeSeriesService();
    this.points = options.historyPoints ?? new HistoricalPointsService();
    this.pointsTimeSeries =
      options.historyPointsTimeSeries ?? new HistoricalPointsTimeSeriesService();
    this.transectService = options.historyTransect ?? new HistoricalTransectService();
    this.areaService = options.historyArea ?? new HistoricalAreaSummaryService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gfs-analysis") {
      throw new Error("GFS analysis query adapter only accepts dataset=gfs-analysis");
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
      throw new Error("Internal GFS analysis routing error: expected point + instant");
    }
    const point = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
    };
    if ((request.selection.fields?.length ?? 0) > 0) {
      return this.fields.getHistoricalFields(historicalFieldsQuerySchema.parse({
        ...point,
        analysisTime: request.time.at,
        ...sparseSelection(request),
      }));
    }
    return this.profile.getHistoricalProfile(historicalProfileQuerySchema.parse({
      ...point,
      analysisTime: request.time.at,
      variables: request.selection.variables,
      pressureLevelsHpa: request.selection.pressureLevelsHpa,
    }));
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal GFS analysis routing error: expected point + range");
    }
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      startTime: request.time.from,
      endTime: request.time.to,
      ...(request.time.hoursUtc === undefined ? {} : { cycleHoursUtc: request.time.hoursUtc }),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    };
    if ((request.selection.fields?.length ?? 0) > 0) {
      return this.fieldsTimeSeries.getHistoricalFieldsTimeSeries(
        historicalFieldsTimeSeriesQuerySchema.parse({
          ...common,
          ...sparseSelection(request),
        }),
      );
    }
    return this.timeSeries.getHistoricalTimeSeries(historicalTimeSeriesQuerySchema.parse({
      ...common,
      variables: request.selection.variables,
      pressureLevelsHpa: request.selection.pressureLevelsHpa,
    }));
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal GFS analysis routing error: expected points + instant");
    }
    return this.points.getPoints(historicalPointsQuerySchema.parse({
      points: request.geometry.points,
      analysisTime: request.time.at,
      ...sparseSelection(request),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal GFS analysis routing error: expected points + range");
    }
    return this.pointsTimeSeries.getPointsTimeSeries(historicalPointsTimeSeriesQuerySchema.parse({
      points: request.geometry.points,
      startTime: request.time.from,
      endTime: request.time.to,
      ...sparseSelection(request),
      ...(request.time.hoursUtc === undefined ? {} : { cycleHoursUtc: request.time.hoursUtc }),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxPointSteps === undefined
        ? {}
        : { maxPointSteps: request.limits.maxPointSteps }),
    }));
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal GFS analysis routing error: expected transect + instant");
    }
    return this.transectService.getTransect(historicalTransectQuerySchema.parse({
      start: request.geometry.start,
      end: request.geometry.end,
      analysisTime: request.time.at,
      ...sparseSelection(request),
      ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
    }));
  }

  private area(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal GFS analysis routing error: expected area + instant");
    }
    return this.areaService.summarize(historicalAreaSummaryQuerySchema.parse({
      ...boundingBox(request),
      analysisTime: request.time.at,
      ...areaScalarSelection(request),
      ...(request.aggregate ?? {}),
      ...(request.limits?.maxGridPoints === undefined
        ? {}
        : { maxGridPoints: request.limits.maxGridPoints }),
    }));
  }
}
