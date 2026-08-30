import { ifsAreaSummaryQuerySchema } from "../../schema/ifs-area-summary.js";
import {
  ifsPointsQuerySchema,
  ifsPointsTimeSeriesQuerySchema,
  ifsTimeSeriesQuerySchema,
  ifsTransectQuerySchema,
} from "../../schema/ifs-spatiotemporal.js";
import { ifsPointQuerySchema } from "../../schema/ifs.js";
import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { IfsAreaSummaryService } from "../ifs-area-summary.js";
import { IfsProfileService } from "../ifs-profile.js";
import {
  IfsPointsService,
  IfsPointsTimeSeriesService,
  IfsTimeSeriesService,
  IfsTransectService,
} from "../ifs-spatiotemporal.js";
import { areaScalarSelection, boundingBox, sparseSelection } from "./helpers.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface IfsQueryAdapterOptions {
  ifsProfile?: Pick<IfsProfileService, "getProfile">;
  ifsTimeSeries?: Pick<IfsTimeSeriesService, "getTimeSeries">;
  ifsPoints?: Pick<IfsPointsService, "getPoints">;
  ifsPointsTimeSeries?: Pick<IfsPointsTimeSeriesService, "getPointsTimeSeries">;
  ifsTransect?: Pick<IfsTransectService, "getTransect">;
  ifsArea?: Pick<IfsAreaSummaryService, "summarize">;
}

export class IfsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly profile: Pick<IfsProfileService, "getProfile">;
  private readonly timeSeries: Pick<IfsTimeSeriesService, "getTimeSeries">;
  private readonly points: Pick<IfsPointsService, "getPoints">;
  private readonly pointsTimeSeries: Pick<IfsPointsTimeSeriesService, "getPointsTimeSeries">;
  private readonly transectService: Pick<IfsTransectService, "getTransect">;
  private readonly areaService: Pick<IfsAreaSummaryService, "summarize">;

  constructor(options: IfsQueryAdapterOptions = {}) {
    this.profile = options.ifsProfile ?? new IfsProfileService();
    this.timeSeries = options.ifsTimeSeries ?? new IfsTimeSeriesService();
    this.points = options.ifsPoints ?? new IfsPointsService();
    this.pointsTimeSeries = options.ifsPointsTimeSeries ?? new IfsPointsTimeSeriesService();
    this.transectService = options.ifsTransect ?? new IfsTransectService();
    this.areaService = options.ifsArea ?? new IfsAreaSummaryService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "ifs") throw new Error("IFS query adapter only accepts dataset=ifs");
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
      throw new Error("Internal IFS routing error: expected point + instant");
    }
    return this.profile.getProfile(ifsPointQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...sparseSelection(request),
    }));
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal IFS routing error: expected point + range");
    }
    return this.timeSeries.getTimeSeries(ifsTimeSeriesQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      ...sparseSelection(request),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    }));
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal IFS routing error: expected points + instant");
    }
    return this.points.getPoints(ifsPointsQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...sparseSelection(request),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal IFS routing error: expected points + range");
    }
    return this.pointsTimeSeries.getPointsTimeSeries(ifsPointsTimeSeriesQuerySchema.parse({
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      ...sparseSelection(request),
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxPointSteps === undefined
        ? {}
        : { maxPointSteps: request.limits.maxPointSteps }),
    }));
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal IFS routing error: expected transect + instant");
    }
    return this.transectService.getTransect(ifsTransectQuerySchema.parse({
      start: request.geometry.start,
      end: request.geometry.end,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...sparseSelection(request),
      ...(request.geometry.samples === undefined ? {} : { samples: request.geometry.samples }),
    }));
  }

  private area(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "area" || !("at" in request.time)) {
      throw new Error("Internal IFS routing error: expected area + instant");
    }
    return this.areaService.summarize(ifsAreaSummaryQuerySchema.parse({
      ...boundingBox(request),
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
      ...areaScalarSelection(request),
      ...(request.aggregate ?? {}),
      ...(request.limits?.maxGridPoints === undefined
        ? {}
        : { maxGridPoints: request.limits.maxGridPoints }),
    }));
  }
}
