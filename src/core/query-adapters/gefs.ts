import type {
  GefsReforecastFieldId,
  GefsReforecastMember,
  GefsReforecastPressureVariableId,
} from "../../catalog/gefs-reforecast.js";
import { gefsAreaSummaryQuerySchema } from "../../schema/gefs-area-summary.js";
import { gefsBundleTimeSeriesQuerySchema } from "../../schema/gefs-bundle-timeseries.js";
import { gefsMemberBundleQuerySchema } from "../../schema/gefs-member-bundle.js";
import { gefsPointsBundleQuerySchema } from "../../schema/gefs-points-bundle.js";
import { gefsPointsBundleTimeSeriesQuerySchema } from "../../schema/gefs-points-bundle-timeseries.js";
import { gefsTransectQuerySchema } from "../../schema/gefs-transect.js";
import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { GefsAreaSummaryService } from "../gefs-area-summary.js";
import { GefsBundleTimeSeriesService } from "../gefs-bundle-timeseries.js";
import { GefsMemberBundleService } from "../gefs-member-bundle.js";
import { GefsPointsBundleService } from "../gefs-points-bundle.js";
import { GefsPointsBundleTimeSeriesService } from "../gefs-points-bundle-timeseries.js";
import { GefsReforecastPointService } from "../gefs-reforecast.js";
import {
  GefsReforecastMixedPointService,
  GefsReforecastMixedPointsService,
  GefsReforecastMixedPointsTimeSeriesService,
  GefsReforecastMixedTimeSeriesService,
} from "../gefs-reforecast-mixed.js";
import { GefsReforecastProfileService } from "../gefs-reforecast-profile.js";
import { GefsReforecastPointsService } from "../gefs-reforecast-points.js";
import { GefsReforecastPointsTimeSeriesService } from "../gefs-reforecast-points-timeseries.js";
import { GefsReforecastTimeSeriesService } from "../gefs-reforecast-timeseries.js";
import { GefsTransectService } from "../gefs-transect.js";
import {
  areaScalarSelection,
  boundingBox,
  ensembleOptions,
  ensembleSelection,
} from "./helpers.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface GefsQueryAdapterOptions {
  gefsBundle?: Pick<GefsMemberBundleService, "getBundle">;
  gefsTimeSeries?: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  gefsPoints?: Pick<GefsPointsBundleService, "getPoints">;
  gefsPointsTimeSeries?: Pick<GefsPointsBundleTimeSeriesService, "getPointsTimeSeries">;
  gefsTransect?: Pick<GefsTransectService, "getTransect">;
  gefsArea?: Pick<GefsAreaSummaryService, "summarize">;
  gefsReforecast?: Pick<GefsReforecastPointService, "getPoint">;
  gefsReforecastMixed?: Pick<GefsReforecastMixedPointService, "getPoint">;
  gefsReforecastMixedPoints?: Pick<GefsReforecastMixedPointsService, "getPoints">;
  gefsReforecastMixedTimeSeries?: Pick<GefsReforecastMixedTimeSeriesService, "getTimeSeries">;
  gefsReforecastMixedPointsTimeSeries?: Pick<
    GefsReforecastMixedPointsTimeSeriesService,
    "getPointsTimeSeries"
  >;
  gefsReforecastProfile?: Pick<GefsReforecastProfileService, "getProfile">;
  gefsReforecastPoints?: Pick<GefsReforecastPointsService, "getPoints">;
  gefsReforecastPointsTimeSeries?: Pick<
    GefsReforecastPointsTimeSeriesService,
    "getPointsTimeSeries"
  >;
  gefsReforecastTimeSeries?: Pick<GefsReforecastTimeSeriesService, "getTimeSeries">;
}

export class GefsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly bundle: Pick<GefsMemberBundleService, "getBundle">;
  private readonly timeSeries: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  private readonly points: Pick<GefsPointsBundleService, "getPoints">;
  private readonly pointsTimeSeries: Pick<GefsPointsBundleTimeSeriesService, "getPointsTimeSeries">;
  private readonly transectService: Pick<GefsTransectService, "getTransect">;
  private readonly areaService: Pick<GefsAreaSummaryService, "summarize">;
  private readonly reforecast: Pick<GefsReforecastPointService, "getPoint">;
  private readonly reforecastMixed: Pick<GefsReforecastMixedPointService, "getPoint">;
  private readonly reforecastMixedPoints: Pick<GefsReforecastMixedPointsService, "getPoints">;
  private readonly reforecastMixedTimeSeries: Pick<GefsReforecastMixedTimeSeriesService, "getTimeSeries">;
  private readonly reforecastMixedPointsTimeSeries: Pick<
    GefsReforecastMixedPointsTimeSeriesService,
    "getPointsTimeSeries"
  >;
  private readonly reforecastProfile: Pick<GefsReforecastProfileService, "getProfile">;
  private readonly reforecastPoints: Pick<GefsReforecastPointsService, "getPoints">;
  private readonly reforecastPointsTimeSeries: Pick<
    GefsReforecastPointsTimeSeriesService,
    "getPointsTimeSeries"
  >;
  private readonly reforecastTimeSeries: Pick<GefsReforecastTimeSeriesService, "getTimeSeries">;

  constructor(options: GefsQueryAdapterOptions = {}) {
    this.bundle = options.gefsBundle ?? new GefsMemberBundleService();
    this.timeSeries = options.gefsTimeSeries ?? new GefsBundleTimeSeriesService();
    this.points = options.gefsPoints ?? new GefsPointsBundleService();
    this.pointsTimeSeries = options.gefsPointsTimeSeries ?? new GefsPointsBundleTimeSeriesService();
    this.transectService = options.gefsTransect ?? new GefsTransectService();
    this.areaService = options.gefsArea ?? new GefsAreaSummaryService();
    this.reforecast = options.gefsReforecast ?? new GefsReforecastPointService();
    this.reforecastMixed = options.gefsReforecastMixed ?? new GefsReforecastMixedPointService();
    this.reforecastMixedPoints =
      options.gefsReforecastMixedPoints ?? new GefsReforecastMixedPointsService();
    this.reforecastMixedTimeSeries =
      options.gefsReforecastMixedTimeSeries ?? new GefsReforecastMixedTimeSeriesService();
    this.reforecastMixedPointsTimeSeries =
      options.gefsReforecastMixedPointsTimeSeries
      ?? new GefsReforecastMixedPointsTimeSeriesService();
    this.reforecastProfile =
      options.gefsReforecastProfile ?? new GefsReforecastProfileService();
    this.reforecastPoints =
      options.gefsReforecastPoints ?? new GefsReforecastPointsService();
    this.reforecastPointsTimeSeries =
      options.gefsReforecastPointsTimeSeries ?? new GefsReforecastPointsTimeSeriesService();
    this.reforecastTimeSeries =
      options.gefsReforecastTimeSeries ?? new GefsReforecastTimeSeriesService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "gefs") {
      throw new Error("GEFS query adapter only accepts dataset=gefs");
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
      throw new Error("Internal GEFS routing error: expected point + instant");
    }
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
    };
    if (request.forecast?.kind === "reforecast") {
      const reforecast = {
        ...common,
        ...reforecastEnsembleOptions(request, true),
      };
      if (hasMixedSelection(request)) {
        return this.reforecastMixed.getPoint({
          ...reforecast,
          variables: request.selection.variables as GefsReforecastPressureVariableId[],
          pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
          fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
        });
      }
      if (request.selection.variables !== undefined) {
        return this.reforecastProfile.getProfile({
          ...reforecast,
          variables: request.selection.variables as GefsReforecastPressureVariableId[],
          pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
        });
      }
      return this.reforecast.getPoint({
        ...reforecast,
        fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
      });
    }
    return this.bundle.getBundle(gefsMemberBundleQuerySchema.parse({
      ...common,
      grid: request.forecast?.grid ?? "0p25",
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
    }));
  }

  private pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal GEFS routing error: expected point + range");
    }
    const common = {
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
    };
    if (request.forecast?.kind === "reforecast") {
      const reforecast = {
        ...common,
        ...reforecastEnsembleOptions(request, false),
      };
      if (hasMixedSelection(request)) {
        return this.reforecastMixedTimeSeries.getTimeSeries({
          ...reforecast,
          variables: request.selection.variables as GefsReforecastPressureVariableId[],
          pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
          fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
        });
      }
      return this.reforecastTimeSeries.getTimeSeries({
        ...reforecast,
        selection: request.selection.variables !== undefined
          ? {
              kind: "profile" as const,
              variables: request.selection.variables as GefsReforecastPressureVariableId[],
              pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
            }
          : {
              kind: "fields" as const,
              fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
            },
      });
    }
    return this.timeSeries.getTimeSeries(gefsBundleTimeSeriesQuerySchema.parse({
      ...common,
      grid: request.forecast?.grid ?? "0p25",
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
    }));
  }

  private pointsInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("at" in request.time)) {
      throw new Error("Internal GEFS routing error: expected points + instant");
    }
    const common = {
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      validTime: request.time.at,
    };
    if (request.forecast?.kind === "reforecast") {
      const reforecast = {
        ...common,
        ...reforecastEnsembleOptions(request, true),
        ...(request.ensemble?.maxMemberSamples === undefined
          ? {}
          : { maxMemberSamples: request.ensemble.maxMemberSamples }),
      };
      if (hasMixedSelection(request)) {
        return this.reforecastMixedPoints.getPoints({
          ...reforecast,
          variables: request.selection.variables as GefsReforecastPressureVariableId[],
          pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
          fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
        });
      }
      return this.reforecastPoints.getPoints({
        ...reforecast,
        selection: request.selection.variables !== undefined
          ? {
              kind: "profile" as const,
              variables: request.selection.variables as GefsReforecastPressureVariableId[],
              pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
            }
          : {
              kind: "fields" as const,
              fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
            },
      });
    }
    return this.points.getPoints(gefsPointsBundleQuerySchema.parse({
      ...common,
      selection: ensembleSelection(request),
      ...ensembleOptions(request),
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
    }));
  }

  private pointsRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "points" || !("from" in request.time)) {
      throw new Error("Internal GEFS routing error: expected points + range");
    }
    const common = {
      points: request.geometry.points,
      run: request.forecast?.run ?? "latest",
      startTime: request.time.from,
      endTime: request.time.to,
      ...(request.time.maxSteps === undefined ? {} : { maxSteps: request.time.maxSteps }),
      ...(request.limits?.maxPointSteps === undefined
        ? {}
        : { maxPointSteps: request.limits.maxPointSteps }),
    };
    if (request.forecast?.kind === "reforecast") {
      const reforecast = {
        ...common,
        ...reforecastEnsembleOptions(request, false),
      };
      if (hasMixedSelection(request)) {
        return this.reforecastMixedPointsTimeSeries.getPointsTimeSeries({
          ...reforecast,
          variables: request.selection.variables as GefsReforecastPressureVariableId[],
          pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
          fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
        });
      }
      return this.reforecastPointsTimeSeries.getPointsTimeSeries({
        ...reforecast,
        selection: request.selection.variables !== undefined
          ? {
              kind: "profile" as const,
              variables: request.selection.variables as GefsReforecastPressureVariableId[],
              pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
            }
          : {
              kind: "fields" as const,
              fields: (request.selection.fields ?? []) as GefsReforecastFieldId[],
            },
      });
    }
    return this.pointsTimeSeries.getPointsTimeSeries(
      gefsPointsBundleTimeSeriesQuerySchema.parse({
        ...common,
        selection: ensembleSelection(request),
        ...ensembleOptions(request),
        ...(request.ensemble?.maxMemberSamples === undefined
          ? {}
          : { maxMemberSamples: request.ensemble.maxMemberSamples }),
      }),
    );
  }

  private transect(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "transect" || !("at" in request.time)) {
      throw new Error("Internal GEFS routing error: expected transect + instant");
    }
    return this.transectService.getTransect(gefsTransectQuerySchema.parse({
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
      throw new Error("Internal GEFS routing error: expected area + instant");
    }
    return this.areaService.summarize(gefsAreaSummaryQuerySchema.parse({
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

function hasMixedSelection(request: QueryAtmosphereRequest): boolean {
  return request.selection.variables !== undefined && (request.selection.fields?.length ?? 0) > 0;
}

function reforecastEnsembleOptions(
  request: QueryAtmosphereRequest,
  includeRawMembers: boolean,
): {
  members?: GefsReforecastMember[];
  quantiles?: number[];
  includeMembers?: boolean;
} {
  return {
    ...(request.ensemble?.members === undefined
      ? {}
      : { members: request.ensemble.members as GefsReforecastMember[] }),
    ...(request.ensemble?.quantiles === undefined
      ? {}
      : { quantiles: request.ensemble.quantiles }),
    ...(!includeRawMembers || request.ensemble?.includeMembers === undefined
      ? {}
      : { includeMembers: request.ensemble.includeMembers }),
  };
}
