import {
  gefsTransectQuerySchema,
  gefsTransectResultSchema,
  type GefsTransectQueryInput,
  type GefsTransectResult,
} from "../schema/gefs-transect.js";
import type { GefsPointsBundleQueryInput, GefsPointsBundleResult } from "../schema/gefs-points-bundle.js";
import { GefsPointsBundleService } from "./gefs-points-bundle.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";

export interface GefsTransectPointsGetter {
  getPoints(query: GefsPointsBundleQueryInput): Promise<GefsPointsBundleResult>;
}

export interface GefsTransectServiceOptions {
  pointsGetter?: GefsTransectPointsGetter;
}

/**
 * Sample an ensemble-native mixed-field cross-section along a great-circle
 * path. Geometry is model-independent and shared with deterministic GFS;
 * meteorological sampling delegates to the GEFS mixed multi-point primitive.
 * One selected member file is therefore reused across every transect point.
 */
export class GefsTransectService {
  private readonly pointsGetter: GefsTransectPointsGetter;

  constructor(options: GefsTransectServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new GefsPointsBundleService();
  }

  async getTransect(input: GefsTransectQueryInput): Promise<GefsTransectResult> {
    const query = gefsTransectQuerySchema.parse(input);
    const points = interpolateGreatCircle(query.start, query.end, query.samples);
    const totalDistanceKm = greatCircleDistanceKm(query.start, query.end);

    const batch = await this.pointsGetter.getPoints({
      points,
      run: query.run,
      validTime: query.validTime,
      selection: query.selection,
      members: query.members,
      quantiles: query.quantiles,
      includeMembers: query.includeMembers,
      maxMemberSamples: query.maxMemberSamples,
    });

    if (batch.points.length !== points.length) {
      throw new Error(`GEFS transect sampling returned ${batch.points.length} points for ${points.length} requested samples`);
    }

    for (const [index, point] of batch.points.entries()) {
      const requested = points[index];
      if (!requested) throw new Error(`GEFS transect point index ${index} has no matching great-circle sample`);
      if (
        point.requestedPoint.latitude !== requested.latitude
        || point.requestedPoint.longitude !== requested.longitude
      ) {
        throw new Error(`GEFS transect sampling changed requested point order at sample ${index}`);
      }
      if (query.includeMembers && point.members === undefined) {
        throw new Error(`GEFS transect member payload was requested but omitted at sample ${index}`);
      }
    }

    return gefsTransectResultSchema.parse({
      model: "gefs_0p50",
      run: batch.run,
      validTime: batch.validTime,
      forecastHour: batch.forecastHour,
      startPoint: { ...query.start },
      endPoint: { ...query.end },
      totalDistanceKm,
      selection: batch.selection,
      includeMembers: batch.includeMembers,
      samples: batch.points.map((point, index) => {
        const fraction = index / (points.length - 1);
        return {
          index,
          fraction,
          distanceKm: totalDistanceKm * fraction,
          requestedPoint: point.requestedPoint,
          gridPoint: point.gridPoint,
          pressureSummaries: point.pressureSummaries,
          fieldSummaries: point.fieldSummaries,
          ...(point.members === undefined ? {} : { members: point.members }),
        };
      }),
      source: batch.source,
    });
  }
}
