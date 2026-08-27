import * as z from "zod/v4";
import {
  igraForecastSkillQuerySchema,
  igraForecastSkillResultSchema,
  type IgraForecastSkillQueryInput,
  type IgraForecastSkillResult,
} from "../schema/igra-skill.js";
import type {
  IgraForecastVerificationResult,
  IgraVerificationVariable,
} from "../schema/igra-verification.js";
import {
  accumulateSkillPressureLevels,
  enumerateNominalTimes,
  evenlySampleTimes,
  finalizeSkillStatistics,
  type ForecastSkillAccumulator,
} from "./forecast-skill.js";
import {
  IgraForecastVerificationService,
} from "./igra-verification.js";

export { enumerateNominalTimes, evenlySampleTimes } from "./forecast-skill.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 366 * DAY_MS;
const CAVEAT =
  "Skill statistics aggregate only successful radiosonde comparisons; each statistic reports its own sample count, failures remain explicit, and sounding/model representativeness limitations still apply" as const;

export interface IgraAtomicForecastVerifier {
  verify(input: {
    latitude: number;
    longitude: number;
    validTime: string;
    leadHours: number;
    variables: IgraVerificationVariable[];
    pressureLevelsHpa: number[];
    stationId?: string;
    maxStationDistanceKm?: number;
    gfsGrid?: "0p25" | "0p50";
  }): Promise<IgraForecastVerificationResult>;
}

export interface IgraForecastSkillServiceOptions {
  verifier?: IgraAtomicForecastVerifier;
  now?: () => Date;
}

export class IgraForecastSkillService {
  private readonly verifier: IgraAtomicForecastVerifier;
  private readonly now: () => Date;

  constructor(options: IgraForecastSkillServiceOptions = {}) {
    this.verifier = options.verifier ?? new IgraForecastVerificationService();
    this.now = options.now ?? (() => new Date());
  }

  async summarize(input: IgraForecastSkillQueryInput): Promise<IgraForecastSkillResult> {
    const query = igraForecastSkillQuerySchema.parse(input);
    const start = new Date(query.startTime);
    const end = new Date(query.endTime);

    if (end > this.now()) {
      throw new Error("IGRA skill summary endTime must not be in the future");
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      throw new Error("IGRA skill summary period must not exceed 366 days");
    }

    const eligible = enumerateNominalTimes(start, end, query.cycleHoursUtc);
    const sampled = evenlySampleTimes(eligible, query.maxValidTimes);
    const evaluations: IgraForecastSkillResult["evaluations"] = [];
    const accumulators = new Map<string, ForecastSkillAccumulator>();
    const stations = new Map<string, IgraForecastSkillResult["stations"][number]>();

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
            ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
            maxStationDistanceKm: query.maxStationDistanceKm,
            ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
          });

          evaluations.push({
            status: "success",
            validTime: result.validTime,
            leadHours,
            stationId: result.station.id,
            gfsGrid: result.gfsGrid,
            matchedPressureLevelsHpa: result.matchedPressureLevelsHpa,
            missingPressureLevelsHpa: result.missingPressureLevelsHpa,
          });
          stations.set(result.station.id, {
            id: result.station.id,
            name: result.station.name,
            latitude: result.station.latitude,
            longitude: result.station.longitude,
            ...(result.station.elevationM === undefined
              ? {}
              : { elevationM: result.station.elevationM }),
          });
          accumulateSkillPressureLevels(accumulators, result.leadHours, result.pressureLevels);
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

    return igraForecastSkillResultSchema.parse({
      model: "gfs_igra_skill_summary",
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
      comparison: "observation_minus_forecast",
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
      stations: [...stations.values()].sort((left, right) => left.id.localeCompare(right.id)),
      source: {
        forecastDataset: "gfs",
        referenceDataset: "igra_v2_2",
        provider: "NOAA NCEI",
      },
      caveat: CAVEAT,
    });
  }
}

