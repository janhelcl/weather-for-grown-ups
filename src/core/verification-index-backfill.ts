import type { HistoricalGfsVariableId } from "../schema/history.js";
import type { IgraVerificationVariable } from "../schema/igra-verification.js";
import {
  MAX_VERIFICATION_INDEX_SELECTED_EVALUATIONS,
  verificationIndexBackfillQuerySchema,
  verificationIndexBackfillResultSchema,
  type VerificationIndexBackfillQueryInput,
  type VerificationIndexBackfillResult,
  type VerificationIndexRecord,
} from "../schema/verification-index.js";
import { enumerateNominalTimes } from "./forecast-skill.js";
import { HistoricalForecastVerificationService } from "./history-verification.js";
import { IgraForecastVerificationService } from "./igra-verification.js";
import {
  VerificationIndexStore,
  verificationRequestKey,
  verificationRequestKeyFromParts,
} from "./verification-index-store.js";

const NOTE = "resumable verification backfill skips materialized atomic cases; archive and observation access remains serial and NOAA-paced" as const;

interface HistoricalVerifier {
  verify(input: {
    latitude: number;
    longitude: number;
    validTime: string;
    leadHours: number;
    variables: HistoricalGfsVariableId[];
    pressureLevelsHpa: number[];
  }): Promise<any>;
}

interface IgraVerifier {
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
  }): Promise<any>;
}

export interface VerificationIndexBackfillServiceOptions {
  store?: VerificationIndexStore;
  analysisVerifier?: HistoricalVerifier;
  igraVerifier?: IgraVerifier;
  now?: () => Date;
}

export class VerificationIndexBackfillService {
  private readonly store: VerificationIndexStore;
  private readonly analysisVerifier: HistoricalVerifier;
  private readonly igraVerifier: IgraVerifier;
  private readonly now: () => Date;

  constructor(options: VerificationIndexBackfillServiceOptions = {}) {
    this.store = options.store ?? new VerificationIndexStore();
    this.analysisVerifier = options.analysisVerifier ?? new HistoricalForecastVerificationService();
    this.igraVerifier = options.igraVerifier ?? new IgraForecastVerificationService();
    this.now = options.now ?? (() => new Date());
  }

  async backfill(input: VerificationIndexBackfillQueryInput): Promise<VerificationIndexBackfillResult> {
    const query = verificationIndexBackfillQuerySchema.parse(input);
    const start = new Date(query.startTime);
    const end = new Date(query.endTime);
    if (end > this.now()) throw new Error("Verification backfill endTime must not be in the future");

    const variables = [...new Set(query.variables)].sort();
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)].sort((a, b) => b - a);
    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const leadHours = [...query.leadHours].sort((a, b) => a - b);
    const validTimes = enumerateNominalTimes(start, end, cycleHoursUtc);
    if (validTimes.length === 0) throw new Error("Requested range contains no selected verification times");
    const selectedEvaluations = validTimes.length * leadHours.length;
    if (selectedEvaluations > MAX_VERIFICATION_INDEX_SELECTED_EVALUATIONS) {
      throw new Error(
        `Requested verification backfill contains ${selectedEvaluations} cases, exceeding the planning limit ${MAX_VERIFICATION_INDEX_SELECTED_EVALUATIONS}. Narrow the range, cycles, or lead set.`,
      );
    }

    let evaluations = validTimes.flatMap((validTime) =>
      leadHours.map((lead) => ({ validTime, leadHours: lead })));
    if (query.order === "newest_first") evaluations = evaluations.reverse();

    const existing = await this.store.readAll();
    const existingKeys = new Set(existing.map(verificationRequestKey));
    const keyFor = (evaluation: { validTime: Date; leadHours: number }) => verificationRequestKeyFromParts({
      referenceDataset: query.referenceDataset,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      validTime: evaluation.validTime.toISOString(),
      leadHours: evaluation.leadHours,
      variables,
      pressureLevelsHpa,
      ...(query.referenceDataset === "igra"
        ? {
            ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
            ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
            maxStationDistanceKm: query.maxStationDistanceKm ?? 250,
          }
        : {}),
    });
    const initiallyMissing = evaluations.filter((evaluation) => !existingKeys.has(keyFor(evaluation)));

    if (query.dryRun) {
      return verificationIndexBackfillResultSchema.parse(buildResult({
        query, variables, pressureLevelsHpa, cycleHoursUtc, leadHours, validTimes,
        alreadyMaterialized: evaluations.length - initiallyMissing.length,
        attempted: 0, materialized: 0, failures: [],
        remaining: initiallyMissing.length, nextEvaluation: initiallyMissing[0] ?? null,
        status: "dry_run", indexPath: this.store.path,
      }));
    }

    const records: VerificationIndexRecord[] = [];
    const failures: VerificationIndexBackfillResult["failures"] = [];
    const materializedKeys = new Set(existingKeys);
    let attempted = 0;
    let stoppedOnError = false;

    for (const evaluation of evaluations) {
      const key = keyFor(evaluation);
      if (materializedKeys.has(key)) continue;
      if (attempted >= query.maxFetches) break;
      attempted += 1;
      const validTime = evaluation.validTime.toISOString();

      try {
        const requestBase = {
          requestedPoint: { latitude: query.latitude, longitude: query.longitude },
          validTime,
          leadHours: evaluation.leadHours,
          variables,
          pressureLevelsHpa,
        };
        let record: VerificationIndexRecord;
        if (query.referenceDataset === "gfs-analysis") {
          const result = await this.analysisVerifier.verify({
            latitude: query.latitude,
            longitude: query.longitude,
            validTime,
            leadHours: evaluation.leadHours,
            variables: variables as HistoricalGfsVariableId[],
            pressureLevelsHpa,
          });
          record = {
            version: 1,
            referenceDataset: "gfs-analysis",
            request: requestBase,
            result,
          };
        } else {
          const maxStationDistanceKm = query.maxStationDistanceKm ?? 250;
          const result = await this.igraVerifier.verify({
            latitude: query.latitude,
            longitude: query.longitude,
            validTime,
            leadHours: evaluation.leadHours,
            variables: variables as IgraVerificationVariable[],
            pressureLevelsHpa,
            ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
            ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
            maxStationDistanceKm,
          });
          record = {
            version: 1,
            referenceDataset: "igra",
            request: {
              ...requestBase,
              ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
              ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
              maxStationDistanceKm,
            },
            result,
          };
        }
        records.push(record);
        materializedKeys.add(verificationRequestKey(record));
      } catch (error) {
        failures.push({
          validTime,
          leadHours: evaluation.leadHours,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!query.continueOnError) {
          stoppedOnError = true;
          break;
        }
      }
    }

    const materialized = await this.store.append(records);
    const remainingEvaluations = evaluations.filter((evaluation) => !materializedKeys.has(keyFor(evaluation)));
    const status = remainingEvaluations.length === 0
      ? "complete"
      : stoppedOnError
        ? "stopped_on_error"
        : attempted >= query.maxFetches
          ? "budget_exhausted"
          : "errors_remaining";

    return verificationIndexBackfillResultSchema.parse(buildResult({
      query, variables, pressureLevelsHpa, cycleHoursUtc, leadHours, validTimes,
      alreadyMaterialized: evaluations.length - initiallyMissing.length,
      attempted, materialized, failures, remaining: remainingEvaluations.length,
      nextEvaluation: remainingEvaluations[0] ?? null, status, indexPath: this.store.path,
    }));
  }
}

function buildResult(input: {
  query: ReturnType<typeof verificationIndexBackfillQuerySchema.parse>;
  variables: string[];
  pressureLevelsHpa: number[];
  cycleHoursUtc: Array<0 | 6 | 12 | 18>;
  leadHours: number[];
  validTimes: Date[];
  alreadyMaterialized: number;
  attempted: number;
  materialized: number;
  failures: VerificationIndexBackfillResult["failures"];
  remaining: number;
  nextEvaluation: { validTime: Date; leadHours: number } | null;
  status: VerificationIndexBackfillResult["status"];
  indexPath: string;
}) {
  return {
    model: "verification_index_backfill",
    indexPath: input.indexPath,
    referenceDataset: input.query.referenceDataset,
    requestedPoint: { latitude: input.query.latitude, longitude: input.query.longitude },
    period: {
      startTime: new Date(input.query.startTime).toISOString(),
      endTime: new Date(input.query.endTime).toISOString(),
      cycleHoursUtc: input.cycleHoursUtc,
    },
    leadHours: input.leadHours,
    selection: { variables: input.variables, pressureLevelsHpa: input.pressureLevelsHpa },
    selectedValidTimes: input.validTimes.length,
    selectedEvaluations: input.validTimes.length * input.leadHours.length,
    alreadyMaterialized: input.alreadyMaterialized,
    fetchBudget: input.query.maxFetches,
    attempted: input.attempted,
    materialized: input.materialized,
    failures: input.failures,
    remaining: input.remaining,
    nextEvaluation: input.nextEvaluation === null
      ? null
      : { validTime: input.nextEvaluation.validTime.toISOString(), leadHours: input.nextEvaluation.leadHours },
    status: input.status,
    note: NOTE,
  };
}
