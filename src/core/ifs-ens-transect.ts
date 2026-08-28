import {
  ifsEnsTransectQuerySchema,
  ifsEnsTransectResultSchema,
  type IfsEnsTransectQueryInput,
  type IfsEnsTransectResult,
} from "../schema/ifs-ens-transect.js";
import type {
  IfsEnsPointsQueryInput,
  IfsEnsPointsResult,
} from "../schema/ifs-ens-points.js";
import { IfsEnsPointsService } from "./ifs-ens-points.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";

export interface IfsEnsTransectPointsGetter {
  getPoints(query: IfsEnsPointsQueryInput): Promise<IfsEnsPointsResult>;
}

export interface IfsEnsTransectServiceOptions {
  pointsGetter?: IfsEnsTransectPointsGetter;
}

export class IfsEnsTransectService {
  private readonly pointsGetter: IfsEnsTransectPointsGetter;

  constructor(options: IfsEnsTransectServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new IfsEnsPointsService();
  }

  async getTransect(input: IfsEnsTransectQueryInput): Promise<IfsEnsTransectResult> {
    const query = ifsEnsTransectQuerySchema.parse(input);
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
      throw new Error(
        `IFS ENS transect sampling returned ${batch.points.length} points for ${points.length} requested samples`,
      );
    }

    for (const [index, point] of batch.points.entries()) {
      const requested = points[index];
      if (!requested) throw new Error(`IFS ENS transect point index ${index} has no matching great-circle sample`);
      if (
        point.requestedPoint.latitude !== requested.latitude
        || point.requestedPoint.longitude !== requested.longitude
      ) {
        throw new Error(`IFS ENS transect sampling changed requested point order at sample ${index}`);
      }
      if (query.includeMembers && point.members === undefined) {
        throw new Error(`IFS ENS transect member payload was requested but omitted at sample ${index}`);
      }
    }

    return ifsEnsTransectResultSchema.parse({
      model: "ifs_ens_0p25",
      run: batch.run,
      validTime: batch.validTime,
      forecastHour: batch.forecastHour,
      startPoint: { ...query.start },
      endPoint: { ...query.end },
      totalDistanceKm,
      selection: batch.selection,
      includeMembers: batch.includeMembers,
      samples: batch.points.map((point, index) => {
        const fraction = index / (batch.points.length - 1);
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
