import {
  historicalTimeSeriesQuerySchema,
  type HistoricalCycleHourUtc,
  type HistoricalProfileQueryInput,
  type HistoricalTimeSeriesQueryInput,
} from "../schema/history.js";
import type { HistoricalProfileResult, HistoricalTimeSeriesResult } from "../schema/history-result.js";
import { NCEI_GFS_GRID4_ANALYSIS_START } from "../sources/ncei-gfs-history.js";
import { HistoricalProfileService } from "./history.js";
import { InvalidRequestError } from "../failure.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;

export interface HistoricalProfileGetter {
  getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface HistoricalTimeSeriesServiceOptions {
  profileGetter?: HistoricalProfileGetter;
  now?: () => Date;
}

export class HistoricalTimeSeriesService {
  private readonly profileGetter: HistoricalProfileGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalTimeSeriesServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService();
    this.now = options.now ?? (() => new Date());
  }

  async getHistoricalTimeSeries(input: HistoricalTimeSeriesQueryInput): Promise<HistoricalTimeSeriesResult> {
    const query = historicalTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    if (startTime < NCEI_GFS_GRID4_ANALYSIS_START) {
      throw new Error(
        `NCEI GFS Grid 4 analysis history begins at ${NCEI_GFS_GRID4_ANALYSIS_START.toISOString()}`,
      );
    }
    if (endTime > this.now()) {
      throw new Error("Historical GFS endTime must not be in the future");
    }

    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const analysisTimes = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (analysisTimes.length === 0) {
      throw new Error("Requested range contains no selected GFS analysis cycles");
    }
    if (analysisTimes.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested historical range contains ${analysisTimes.length} selected GFS analyses, exceeding maxSteps=${query.maxSteps}. Narrow the range, select fewer cycleHoursUtc, or raise maxSteps.`,
      );
    }

    // Intentionally serial. Cache misses share the NOAA file-backed courtesy limiter, and
    // historical archive access should not fan out concurrent NCEI requests.
    const profiles: HistoricalProfileResult[] = [];
    for (const analysisTime of analysisTimes) {
      profiles.push(await this.profileGetter.getHistoricalProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        analysisTime: analysisTime.toISOString(),
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      }));
    }

    const first = profiles[0];
    if (!first) throw new Error("No historical GFS profiles returned for time series");
    for (const profile of profiles) {
      if (
        profile.gridPoint.latitude !== first.gridPoint.latitude
        || profile.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("Historical GFS grid point changed within one time-series query");
      }
      if (
        profile.source.provider !== first.source.provider
        || profile.source.access !== first.source.access
      ) {
        throw new Error("Historical GFS data source changed within one time-series query");
      }
    }

    return {
      model: "gfs_grid4_analysis_0p5",
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
        cycleHoursUtc,
      },
      source: {
        provider: first.source.provider,
        access: first.source.access,
      },
      series: profiles.map((profile) => ({
        analysisTime: profile.analysisTime,
        levels: profile.levels,
        dataset: profile.source.dataset,
        cacheHit: profile.source.cacheHit,
      })),
      caveat: first.caveat,
    };
  }
}

export function historicalAnalysisTimesInRange(
  startTime: Date,
  endTime: Date,
  cycleHoursUtc: readonly HistoricalCycleHourUtc[],
): Date[] {
  if (startTime > endTime) return [];
  const selected = new Set<number>(cycleHoursUtc);
  const startOfUtcDay = Date.UTC(
    startTime.getUTCFullYear(),
    startTime.getUTCMonth(),
    startTime.getUTCDate(),
  );
  const times: Date[] = [];
  for (let timestamp = startOfUtcDay; timestamp <= endTime.getTime(); timestamp += SIX_HOURS_MS) {
    if (timestamp < startTime.getTime()) continue;
    const candidate = new Date(timestamp);
    if (selected.has(candidate.getUTCHours())) times.push(candidate);
  }
  return times;
}
