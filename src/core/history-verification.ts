import {
  historicalForecastVerificationQuerySchema,
  type HistoricalForecastVerificationQueryInput,
} from "../schema/history-verification.js";
import type { HistoricalForecastVerificationResult } from "../schema/history-verification-result.js";
import type { HistoricalProfileQueryInput } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import { NCEI_GFS_GRID4_FORECAST_START } from "../sources/ncei-gfs-forecast-history.js";
import { ArchivedGfsForecastProfileService, type ArchivedGfsForecastProfileQuery, type ArchivedGfsForecastProfileResult } from "./history-forecast.js";
import { HistoricalProfileService } from "./history.js";
import { circularDegreeDelta } from "./run-comparison.js";

const HOUR_MS = 60 * 60 * 1_000;
const CAVEAT = "Forecast verification against GFS model analysis, not direct observations; historical GFS model versions changed over time" as const;

type HistoricalLevel = HistoricalProfileResult["levels"][number];

export interface HistoricalAnalysisProfileGetter {
  getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface ArchivedForecastProfileGetter {
  getArchivedForecastProfile(input: ArchivedGfsForecastProfileQuery): Promise<ArchivedGfsForecastProfileResult>;
}

export interface HistoricalForecastVerificationServiceOptions {
  analysisGetter?: HistoricalAnalysisProfileGetter;
  forecastGetter?: ArchivedForecastProfileGetter;
  now?: () => Date;
}

export class HistoricalForecastVerificationService {
  private readonly analysisGetter: HistoricalAnalysisProfileGetter;
  private readonly forecastGetter: ArchivedForecastProfileGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalForecastVerificationServiceOptions = {}) {
    this.analysisGetter = options.analysisGetter ?? new HistoricalProfileService();
    this.forecastGetter = options.forecastGetter ?? new ArchivedGfsForecastProfileService();
    this.now = options.now ?? (() => new Date());
  }

  async verify(input: HistoricalForecastVerificationQueryInput): Promise<HistoricalForecastVerificationResult> {
    const query = historicalForecastVerificationQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    if (validTime > this.now()) throw new Error("Historical verification validTime must not be in the future");

    const forecastRun = new Date(validTime.getTime() - query.leadHours * HOUR_MS);
    if (forecastRun < NCEI_GFS_GRID4_FORECAST_START) {
      throw new Error(
        `Requested lead resolves to forecast run ${forecastRun.toISOString()}, before NCEI GFS Grid 4 forecast history begins at ${NCEI_GFS_GRID4_FORECAST_START.toISOString()}`,
      );
    }

    // Keep archive access serial. Both source implementations share WFG's file-backed
    // NOAA courtesy limiter, so a cache miss cannot turn verification into a burst.
    const analysis = await this.analysisGetter.getHistoricalProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      analysisTime: validTime.toISOString(),
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
    });
    const forecast = await this.forecastGetter.getArchivedForecastProfile({
      runTime: forecastRun,
      forecastHour: query.leadHours,
      latitude: query.latitude,
      longitude: query.longitude,
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
    });

    if (forecast.validTime !== analysis.analysisTime) {
      throw new Error("Archived GFS forecast valid time does not match verification analysis time");
    }
    if (
      forecast.gridPoint.latitude !== analysis.gridPoint.latitude
      || forecast.gridPoint.longitude !== analysis.gridPoint.longitude
    ) {
      throw new Error("Archived forecast and analysis sampled different Grid 4 points");
    }

    return {
      model: "gfs_grid4_archive_verification_0p5",
      validTime: validTime.toISOString(),
      leadHours: query.leadHours,
      forecastRun: forecastRun.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: analysis.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      comparison: "analysis_minus_forecast",
      forecast: {
        model: forecast.model,
        runTime: forecast.runTime,
        forecastHour: forecast.forecastHour,
        validTime: forecast.validTime,
        levels: forecast.levels,
        dataset: forecast.source.dataset,
        cacheHit: forecast.source.cacheHit,
      },
      analysis: {
        model: analysis.model,
        analysisTime: analysis.analysisTime,
        levels: analysis.levels,
        dataset: analysis.source.dataset,
        cacheHit: analysis.source.cacheHit,
      },
      pressureLevels: compareForecastToAnalysis(forecast.levels, analysis.levels),
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        forecastArchiveAvailability: "online availability varies; older forecast data may require NCEI HAS",
      },
      caveat: CAVEAT,
    };
  }
}

export function compareForecastToAnalysis(
  forecastLevels: readonly HistoricalLevel[],
  analysisLevels: readonly HistoricalLevel[],
): HistoricalForecastVerificationResult["pressureLevels"] {
  const forecasts = new Map(forecastLevels.map((level) => [level.pressureHpa, level]));
  const analyses = new Map(analysisLevels.map((level) => [level.pressureHpa, level]));
  const pressures = [...new Set([...forecasts.keys(), ...analyses.keys()])].sort((a, b) => b - a);

  return pressures.map((pressureHpa) => ({
    pressureHpa,
    changes: compareLevel(forecasts.get(pressureHpa), analyses.get(pressureHpa)),
  }));
}

function compareLevel(forecast: HistoricalLevel | undefined, analysis: HistoricalLevel | undefined) {
  if (!forecast || !analysis) return [];
  const forecastRecord = forecast as unknown as Record<string, unknown>;
  const analysisRecord = analysis as unknown as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(forecastRecord), ...Object.keys(analysisRecord)])]
    .filter((field) => field !== "pressureHpa")
    .sort();

  return fields.flatMap((field) => {
    const forecastValue = forecastRecord[field];
    const analysisValue = analysisRecord[field];
    if (
      typeof forecastValue !== "number"
      || typeof analysisValue !== "number"
      || !Number.isFinite(forecastValue)
      || !Number.isFinite(analysisValue)
    ) return [];
    const deltaKind = /direction.*deg/i.test(field) ? "circular_degrees" as const : "linear" as const;
    return [{
      field,
      forecast: forecastValue,
      analysis: analysisValue,
      delta: deltaKind === "circular_degrees"
        ? circularDegreeDelta(forecastValue, analysisValue)
        : analysisValue - forecastValue,
      deltaKind,
    }];
  });
}
