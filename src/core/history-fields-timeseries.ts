import {
  historicalFieldsTimeSeriesQuerySchema,
  type HistoricalFieldsTimeSeriesQueryInput,
  type HistoricalFieldsTimeSeriesResult,
} from "../schema/history-fields-timeseries.js";
import type { HistoricalFieldsQueryInput, HistoricalFieldsResult } from "../schema/history-fields.js";
import { GFS_ANALYSIS_START } from "../sources/gfs-analysis.js";
import { HistoricalFieldsService } from "./history-fields.js";
import { historicalAnalysisTimesInRange } from "./history-time-series.js";
import { InvalidRequestError } from "../failure.js";

export interface HistoricalFieldsGetter {
  getHistoricalFields(input: HistoricalFieldsQueryInput): Promise<HistoricalFieldsResult>;
}

export interface HistoricalFieldsTimeSeriesServiceOptions {
  fieldsGetter?: HistoricalFieldsGetter;
  now?: () => Date;
}

export class HistoricalFieldsTimeSeriesService {
  private readonly fieldsGetter: HistoricalFieldsGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalFieldsTimeSeriesServiceOptions = {}) {
    this.fieldsGetter = options.fieldsGetter ?? new HistoricalFieldsService();
    this.now = options.now ?? (() => new Date());
  }

  async getHistoricalFieldsTimeSeries(
    input: HistoricalFieldsTimeSeriesQueryInput,
  ): Promise<HistoricalFieldsTimeSeriesResult> {
    const query = historicalFieldsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    if (startTime < GFS_ANALYSIS_START) {
      throw new Error(`GFS Grid 4 analysis history begins at ${GFS_ANALYSIS_START.toISOString()}`);
    }
    if (endTime > this.now()) throw new Error("Historical GFS endTime must not be in the future");

    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const analysisTimes = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (analysisTimes.length === 0) throw new Error("Requested range contains no selected GFS analysis cycles");
    if (analysisTimes.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested historical mixed-field range contains ${analysisTimes.length} selected GFS analyses, exceeding maxSteps=${query.maxSteps}. Narrow the range, select fewer cycleHoursUtc, or raise maxSteps.`,
      );
    }

    const steps: HistoricalFieldsResult[] = [];
    for (const analysisTime of analysisTimes) {
      steps.push(await this.fieldsGetter.getHistoricalFields({
        latitude: query.latitude,
        longitude: query.longitude,
        analysisTime: analysisTime.toISOString(),
        ...(query.variables ? { variables: query.variables } : {}),
        ...(query.pressureLevelsHpa ? { pressureLevelsHpa: query.pressureLevelsHpa } : {}),
        fields: query.fields,
      }));
    }

    const first = steps[0];
    if (!first) throw new Error("No historical GFS mixed fields returned for time series");
    for (const step of steps) {
      if (step.gridPoint.latitude !== first.gridPoint.latitude || step.gridPoint.longitude !== first.gridPoint.longitude) {
        throw new Error("Historical GFS grid point changed within one mixed-field time-series query");
      }
      if (step.source.provider !== first.source.provider || step.source.access !== first.source.access) {
        throw new Error("Historical GFS data source changed within one mixed-field time-series query");
      }
    }

    return {
      model: "gfs_grid4_analysis_0p5",
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        ...(query.variables ? { variables: query.variables } : {}),
        ...(query.pressureLevelsHpa ? { pressureLevelsHpa: query.pressureLevelsHpa } : {}),
        fields: query.fields,
        cycleHoursUtc,
      },
      source: { provider: first.source.provider, access: first.source.access },
      series: steps.map((step) => ({
        analysisTime: step.analysisTime,
        ...(step.levels ? { levels: step.levels } : {}),
        fields: step.fields,
        dataset: step.source.dataset,
        cacheHit: step.source.cacheHit,
      })),
      caveat: first.caveat,
    };
  }
}
