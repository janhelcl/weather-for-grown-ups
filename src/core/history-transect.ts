import {
  historicalTransectQuerySchema,
  historicalTransectResultSchema,
  type HistoricalTransectQueryInput,
  type HistoricalTransectResult,
} from "../schema/history-transect.js";
import type { HistoricalPointsQueryInput, HistoricalPointsResult } from "../schema/history-points.js";
import { HistoricalPointsService } from "./history-points.js";
import { greatCircleDistanceKm, interpolateGreatCircle } from "./transect.js";

const CAVEAT = "GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalTransectPointsGetter {
  getPoints(query: HistoricalPointsQueryInput): Promise<HistoricalPointsResult>;
}

export interface HistoricalTransectServiceOptions {
  pointsGetter?: HistoricalTransectPointsGetter;
}

export class HistoricalTransectService {
  private readonly pointsGetter: HistoricalTransectPointsGetter;

  constructor(options: HistoricalTransectServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new HistoricalPointsService();
  }

  async getTransect(input: HistoricalTransectQueryInput): Promise<HistoricalTransectResult> {
    const query = historicalTransectQuerySchema.parse(input);
    const points = interpolateGreatCircle(query.start, query.end, query.samples);
    const totalDistanceKm = greatCircleDistanceKm(query.start, query.end);
    const variables = query.variables ? [...new Set(query.variables)] : undefined;
    const pressureLevelsHpa = query.pressureLevelsHpa ? [...new Set(query.pressureLevelsHpa)] : undefined;
    const fields = query.fields ? [...new Set(query.fields)] : undefined;

    const batch = await this.pointsGetter.getPoints({
      points,
      analysisTime: query.analysisTime,
      ...(variables ? { variables } : {}),
      ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
      ...(fields ? { fields } : {}),
    });

    if (batch.points.length !== points.length) {
      throw new Error(
        `Historical transect sampling returned ${batch.points.length} points for ${points.length} requested samples`,
      );
    }

    return historicalTransectResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: batch.analysisTime,
      startPoint: { ...query.start },
      endPoint: { ...query.end },
      totalDistanceKm,
      selection: {
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
      },
      samples: batch.points.map((point, index) => {
        const fraction = index / (batch.points.length - 1);
        return {
          index,
          fraction,
          distanceKm: totalDistanceKm * fraction,
          ...point,
        };
      }),
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        composition: "great_circle_to_serial_point_queries",
      },
      caveat: CAVEAT,
    });
  }
}
