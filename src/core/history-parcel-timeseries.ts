import {
  historicalParcelTimeSeriesQuerySchema,
  type HistoricalParcelQueryInput,
  type HistoricalParcelResult,
  type HistoricalParcelTimeSeriesQueryInput,
  type HistoricalParcelTimeSeriesResult,
} from "../schema/history-parcel.js";
import { GFS_ANALYSIS_START } from "../sources/gfs-analysis.js";
import { historicalAnalysisTimesInRange } from "./history-time-series.js";
import { HistoricalParcelService } from "./history-parcel.js";
import { InvalidRequestError } from "../failure.js";

export interface HistoricalParcelGetter {
  getHistoricalParcel(input: HistoricalParcelQueryInput): Promise<HistoricalParcelResult>;
}

export interface HistoricalParcelTimeSeriesServiceOptions {
  parcelGetter?: HistoricalParcelGetter;
  now?: () => Date;
}

export class HistoricalParcelTimeSeriesService {
  private readonly parcelGetter: HistoricalParcelGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalParcelTimeSeriesServiceOptions = {}) {
    this.parcelGetter = options.parcelGetter ?? new HistoricalParcelService();
    this.now = options.now ?? (() => new Date());
  }

  async getHistoricalParcelTimeSeries(
    input: HistoricalParcelTimeSeriesQueryInput,
  ): Promise<HistoricalParcelTimeSeriesResult> {
    const query = historicalParcelTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    if (startTime < GFS_ANALYSIS_START) {
      throw new Error(`GFS Grid 4 analysis history begins at ${GFS_ANALYSIS_START.toISOString()}`);
    }
    if (endTime > this.now()) throw new Error("Historical GFS endTime must not be in the future");

    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)];
    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const analysisTimes = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (analysisTimes.length === 0) throw new Error("Requested range contains no selected GFS analysis cycles");
    if (analysisTimes.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested historical parcel range contains ${analysisTimes.length} selected GFS analyses, exceeding maxSteps=${query.maxSteps}. Narrow the range, select fewer cycleHoursUtc, or raise maxSteps.`,
      );
    }

    // Intentionally serial: each parcel uses one historical mixed-state request,
    // whose underlying cache misses share WFG's file-backed NOAA limiter.
    const steps: HistoricalParcelResult[] = [];
    for (const analysisTime of analysisTimes) {
      steps.push(await this.parcelGetter.getHistoricalParcel({
        latitude: query.latitude,
        longitude: query.longitude,
        analysisTime: analysisTime.toISOString(),
        pressureLevelsHpa,
        parcel: query.parcel,
      }));
    }

    const first = steps[0];
    if (!first) throw new Error("No historical GFS parcels returned for time series");
    for (const step of steps) {
      if (step.gridPoint.latitude !== first.gridPoint.latitude || step.gridPoint.longitude !== first.gridPoint.longitude) {
        throw new Error("Historical GFS grid point changed within one parcel time-series query");
      }
      if (step.source.provider !== first.source.provider || step.source.access !== first.source.access) {
        throw new Error("Historical GFS data source changed within one parcel time-series query");
      }
    }

    return {
      model: "gfs_grid4_analysis_0p5",
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        pressureLevelsHpa,
        parcel: query.parcel,
        cycleHoursUtc,
      },
      source: {
        provider: first.source.provider,
        access: first.source.access,
      },
      series: steps.map((step) => ({
        analysisTime: step.analysisTime,
        levels: step.levels,
        parcel: step.parcel,
        dataset: step.source.dataset,
        cacheHit: step.source.cacheHit,
      })),
      caveat: first.caveat,
    };
  }
}
