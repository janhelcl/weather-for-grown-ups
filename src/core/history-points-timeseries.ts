import {
  historicalPointsTimeSeriesQuerySchema,
  historicalPointsTimeSeriesResultSchema,
  type HistoricalPointsTimeSeriesQueryInput,
  type HistoricalPointsTimeSeriesResult,
} from "../schema/history-points-timeseries.js";
import type { HistoricalPointsQueryInput, HistoricalPointsResult } from "../schema/history-points.js";
import { GFS_ANALYSIS_START } from "../sources/gfs-analysis.js";
import { HistoricalPointsService } from "./history-points.js";
import { historicalAnalysisTimesInRange } from "./history-time-series.js";
import { InvalidRequestError } from "../failure.js";

const CAVEAT = "GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalPointsGetter {
  getPoints(query: HistoricalPointsQueryInput): Promise<HistoricalPointsResult>;
}

export interface HistoricalPointsTimeSeriesServiceOptions {
  pointsGetter?: HistoricalPointsGetter;
  now?: () => Date;
}

export class HistoricalPointsTimeSeriesService {
  private readonly pointsGetter: HistoricalPointsGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalPointsTimeSeriesServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new HistoricalPointsService();
    this.now = options.now ?? (() => new Date());
  }

  async getPointsTimeSeries(
    input: HistoricalPointsTimeSeriesQueryInput,
  ): Promise<HistoricalPointsTimeSeriesResult> {
    const query = historicalPointsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    if (startTime < GFS_ANALYSIS_START) {
      throw new Error(
        `GFS Grid 4 analysis history begins at ${GFS_ANALYSIS_START.toISOString()}`,
      );
    }
    if (endTime > this.now()) throw new Error("Historical GFS endTime must not be in the future");

    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const analysisTimes = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (analysisTimes.length === 0) throw new Error("Requested range contains no selected GFS analysis cycles");
    if (analysisTimes.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested historical multi-point range contains ${analysisTimes.length} selected GFS analyses, exceeding maxSteps=${query.maxSteps}.`,
      );
    }

    const pointSteps = query.points.length * analysisTimes.length;
    if (pointSteps > query.maxPointSteps) {
      throw new InvalidRequestError(
        `Requested historical matrix contains ${query.points.length} points × ${analysisTimes.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${query.maxPointSteps}.`,
      );
    }

    const variables = query.variables ? [...new Set(query.variables)] : undefined;
    const pressureLevelsHpa = query.pressureLevelsHpa ? [...new Set(query.pressureLevelsHpa)] : undefined;
    const fields = query.fields ? [...new Set(query.fields)] : undefined;

    const batches: HistoricalPointsResult[] = [];
    // Intentionally serial across both time and the nested point service.
    for (const analysisTime of analysisTimes) {
      batches.push(await this.pointsGetter.getPoints({
        points: query.points,
        analysisTime: analysisTime.toISOString(),
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
      }));
    }

    const first = batches[0];
    if (!first) throw new Error("No historical GFS multi-point results returned for time series");
    for (const [stepIndex, batch] of batches.entries()) {
      if (batch.analysisTime !== analysisTimes[stepIndex]!.toISOString()) {
        throw new Error("Historical multi-point result time changed within one time-series query");
      }
      if (batch.points.length !== query.points.length) {
        throw new Error("Historical multi-point result changed point count within one time-series query");
      }
      for (const [pointIndex, point] of batch.points.entries()) {
        const requested = query.points[pointIndex]!;
        const initial = first.points[pointIndex]!;
        if (
          point.requestedPoint.latitude !== requested.latitude
          || point.requestedPoint.longitude !== requested.longitude
        ) {
          throw new Error("Historical multi-point result changed input ordering within one time-series query");
        }
        if (
          point.gridPoint.latitude !== initial.gridPoint.latitude
          || point.gridPoint.longitude !== initial.gridPoint.longitude
        ) {
          throw new Error("Historical GFS grid point changed across analysis cycles for one requested point");
        }
      }
    }

    return historicalPointsTimeSeriesResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      selection: {
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
        cycleHoursUtc,
      },
      source: {
        provider: first.source.provider,
        access: first.source.access,
        composition: "serial_cycle_point_queries",
      },
      series: batches.map((batch) => ({
        analysisTime: batch.analysisTime,
        points: batch.points,
      })),
      caveat: CAVEAT,
    });
  }
}
