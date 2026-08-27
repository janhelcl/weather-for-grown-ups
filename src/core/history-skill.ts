import * as z from "zod/v4";
import {
  historicalForecastSkillQuerySchema,
  historicalForecastSkillResultSchema,
  type HistoricalForecastSkillQueryInput,
  type HistoricalForecastSkillResult,
} from "../schema/history-skill.js";
import type { HistoricalForecastVerificationResult } from "../schema/history-verification-result.js";
import {
  accumulateSkillPressureLevels,
  enumerateNominalTimes,
  evenlySampleTimes,
  finalizeSkillStatistics,
  type ForecastSkillAccumulator,
} from "./forecast-skill.js";
import { HistoricalForecastVerificationService } from "./history-verification.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 366 * DAY_MS;
const CAVEAT =
  "Skill statistics compare archived GFS forecasts with later GFS model analyses, not direct observations; each statistic reports its own sample count, failures remain explicit, and historical GFS model versions changed over time" as const;

export interface HistoricalAtomicForecastVerifier {
  verify(input: {
    latitude: number;
    longitude: number;
    validTime: string;
    leadHours: number;
    variables: HistoricalForecastSkillQueryInput["variables"];
    pressureLevelsHpa: number[];
  }): Promise<HistoricalForecastVerificationResult>;
}

export interface HistoricalForecastSkillServiceOptions {
  verifier?: HistoricalAtomicForecastVerifier;
  now?: () => Date;
}

export class HistoricalForecastSkillService {
  private readonly verifier: HistoricalAtomicForecastVerifier;
  private readonly now: () => Date;

  constructor(options: HistoricalForecastSkillServiceOptions = {}) {
    this.verifier = options.verifier ?? new HistoricalForecastVerificationService();
    this.now = options.now ?? (() => new Date());
  }

  async summarize(input: HistoricalForecastSkillQueryInput): Promise<HistoricalForecastSkillResult> {
    const query = historicalForecastSkillQuerySchema.parse(input);
    const start = new Date(query.startTime);
    const end = new Date(query.endTime);

    if (end > this.now()) {
      throw new Error("GFS-analysis skill summary endTime must not be in the future");
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      throw new Error("GFS-analysis skill summary period must not exceed 366 days");
    }

    const eligible = enumerateNominalTimes(start, end, query.cycleHoursUtc);
    const sampled = evenlySampleTimes(eligible, query.maxValidTimes);
    const evaluations: HistoricalForecastSkillResult["evaluations"] = [];
    const accumulators = new Map<string, ForecastSkillAccumulator>();

    for (const validTime of sampled) {
      for (const leadHours of query.leadHours) {
        try {
          const result = await this.verifier.verify({
            latitude: query.latitude,
            longitude: query.longitude,
            validTime: validTime.toISOString(),
            leadHours,
            variables: [...query.variables],
            pressureLevelsHpa: [...query.pressureLevelsHpa],
          });

          evaluations.push({
            status: "success",
            validTime: result.validTime,
            leadHours,
            gridPoint: result.gridPoint,
          });
          accumulateSkillPressureLevels(accumulators, leadHours, result.pressureLevels);
        } catch (error) {
          if (error instanceof z.ZodError) throw error;
          evaluations.push({
            status: "failed",
            validTime: validTime.toISOString(),
            leadHours,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const successfulEvaluations = evaluations.filter(
      (evaluation) => evaluation.status === "success",
    ).length;
    const failedEvaluations = evaluations.length - successfulEvaluations;

    return historicalForecastSkillResultSchema.parse({
      model: "gfs_grid4_analysis_skill_summary_0p5",
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      period: {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        cycleHoursUtc: query.cycleHoursUtc,
        eligibleValidTimes: eligible.length,
        sampledValidTimes: sampled.map((time) => time.toISOString()),
        truncated: sampled.length < eligible.length,
        sampling: "evenly_spaced_nominal_times",
      },
      leadHours: query.leadHours,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
      },
      comparison: "analysis_minus_forecast",
      evaluations,
      availability: {
        requestedEvaluations: evaluations.length,
        successfulEvaluations,
        failedEvaluations,
        successRate: evaluations.length === 0
          ? 0
          : successfulEvaluations / evaluations.length,
      },
      statistics: finalizeSkillStatistics(accumulators),
      source: {
        forecastDataset: "gfs",
        referenceDataset: "gfs-analysis",
        provider: "NOAA NCEI",
        grid: "0p50",
      },
      caveat: CAVEAT,
    });
  }
}
