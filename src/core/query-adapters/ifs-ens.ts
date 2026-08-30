import { ifsEnsAreaSummaryQuerySchema } from "../../schema/ifs-ens-area-summary.js";
import {
  ifsEnsPointsQuerySchema,
  ifsEnsPointsTimeSeriesQuerySchema,
} from "../../schema/ifs-ens-points.js";
import { ifsEnsTimeSeriesQuerySchema } from "../../schema/ifs-ens-timeseries.js";
import { ifsEnsTransectQuerySchema } from "../../schema/ifs-ens-transect.js";
import { ifsEnsMemberBundleQuerySchema } from "../../schema/ifs-ens.js";
import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { IfsEnsAreaSummaryService } from "../ifs-ens-area-summary.js";
import { IfsEnsMemberBundleService } from "../ifs-ens-member-bundle.js";
import {
  IfsEnsPointsService,
  IfsEnsPointsTimeSeriesService,
} from "../ifs-ens-points.js";
import { IfsEnsTimeSeriesService } from "../ifs-ens-timeseries.js";
import { IfsEnsTransectService } from "../ifs-ens-transect.js";
import {
  areaScalarSelection,
  boundingBox,
  ensembleOptions,
  ensembleSelection,
} from "./helpers.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface IfsEnsQueryAdapterOptions {
  ifsEnsBundle?: Pick<IfsEnsMemberBundleService, "getBundle">;
  ifsEnsTimeSeries?: Pick<IfsEnsTimeSeriesService, "getTimeSeries">;
  ifsEnsPoints?: Pick<IfsEnsPointsService, "getPoints">;
  ifsEnsPointsTimeSeries?: Pick<IfsEnsPointsTimeSeriesService, "getPointsTimeSeries">;
  ifsEnsTransect?: Pick<IfsEnsTransectService, "getTransect">;
  ifsEnsArea?: Pick<IfsEnsAreaSummaryService, "summarize">;
}

export class IfsEnsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly bundle: Pick<IfsEnsMemberBundleService, "getBundle">;
  private readonly timeSeries: Pick<IfsEnsTimeSeriesService, "getTimeSeries">;
  private readonly points: Pick<IfsEnsPointsService, "getPoints">;
  private readonly pointsTimeSeries: Pick<IfsEnsPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly transectService: Pick<IfsEnsTransectService, "getTransect">;
  private readonly areaService: Pick<IfsEnsAreaSummaryService, "summarize">;

  constructor(options: IfsEnsQueryAdapterOptions = {}) {
    this.bundle = options.ifsEnsBundle ?? new IfsEnsMemberBundleService();
    this.timeSeries = options.ifsEnsTimeSeries ?? new IfsEnsTimeSeriesService();
    this.points = options.ifsEnsPoints ?? new IfsEnsPointsService();
    this.pointsTimeSeries = options.ifsEnsPointsTimeSeries ?? new IfsEnsPointsTimeSeriesService();
    this.transectService = options.ifsEnsTransect ?? new IfsEnsTransectService();
    this.areaService = options.ifsEnsArea ?? new IfsEnsAreaSummaryService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "ifs-ens") {
      throw new Error("IFS ENS query adapter only accepts dataset=ifs-ens");
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
      throw new Error("Internal IFS ENS routing error: expected point + instant");
    }
    return this.bundle.getBundle(ifsEnsMemberBundleQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
    }));
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected point + range");
    }
    return this.timeSeries.getTimeSeries(ifsEnsTimeSeriesQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
    }));
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected points + instant");
    }
    return this.points.getPoints(ifsEnsPointsQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected points + range");
    }
    return this.pointsTimeSeries.getPointsTimeSeries(ifsEnsPointsTimeSeriesQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxPointSteps === undefined
        ? {}
        : { maxPointSteps: request.limits.maxPointSteps }),
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
    }));
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected transect + instant");
    }
    return this.transectService.getTransect(ifsEnsTransectQuerySchema.parse({
      start: request.geometry.start,
      end: request.geometry.end,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
      ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
    }));
  }

  private area(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal IFS ENS routing error: expected area + instant");
    }
    return this.areaService.summarize(ifsEnsAreaSummaryQuerySchema.parse({
      ...boundingBox(request),
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...areaScalarSelection(request),
      ...(request.aggregate ?? {}),
      ...ensembleOptions(request),
      ...(request.limits?.maxGridPoints === undefined
        ? {}
        : { maxGridPoints: request.limits.maxGridPoints }),
      ...(request.limits?.maxMemberGridPoints === undefined
        ? {}
        : { maxMemberGridPoints: request.limits.maxMemberGridPoints }),
    }));
  }
}
