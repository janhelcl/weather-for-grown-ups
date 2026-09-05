import type { HistoricalCycleHourUtc, HistoricalGfsVariableId } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import {
  historicalIndexBackfillQuerySchema,
  MAX_HISTORICAL_BACKFILL_SELECTED_CYCLES,
  type HistoricalIndexBackfillQueryInput,
  type HistoricalIndexBackfillResult,
  type HistoricalIndexRecord,
} from "../schema/history-index.js";
import { GFS_ANALYSIS_START } from "../sources/gfs-analysis.js";
import { HistoricalProfileIndexStore, canonicalSelection, sameGridPoint } from "./history-index-store.js";
import { historicalAnalysisTimesInRange, type HistoricalProfileGetter } from "./history-time-series.js";
import { HistoricalProfileService } from "./history.js";

const NOTE = "resumable backfill skips materialized Grid 4 analyses before fetch; archive access remains serial and NOAA-paced" as const;

export interface HistoricalIndexBackfillServiceOptions {
  store?: HistoricalProfileIndexStore;
  profileGetter?: HistoricalProfileGetter;
  now?: () => Date;
}

/**
 * Populate the local history index across ranges much larger than the interactive
 * history-timeseries limit. This is deliberately an orchestrator, not a faster
 * archive transport: it preserves exact historical GFS-analysis semantics and the
 * shared NOAA request pacing while making long backfills resumable/idempotent.
 */
export class HistoricalIndexBackfillService {
  private readonly store: HistoricalProfileIndexStore;
  private readonly profileGetter: HistoricalProfileGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalIndexBackfillServiceOptions = {}) {
    this.store = options.store ?? new HistoricalProfileIndexStore();
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService();
    this.now = options.now ?? (() => new Date());
  }

  async backfill(input: HistoricalIndexBackfillQueryInput): Promise<HistoricalIndexBackfillResult> {
    const query = historicalIndexBackfillQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    if (startTime < GFS_ANALYSIS_START) {
      throw new Error(`GFS Grid 4 analysis history begins at ${GFS_ANALYSIS_START.toISOString()}`);
    }
    if (endTime > this.now()) throw new Error("Historical GFS backfill endTime must not be in the future");

    const variables = normalizeVariables(query.variables);
    const pressureLevelsHpa = normalizeLevels(query.pressureLevelsHpa);
    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const chronological = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (chronological.length === 0) throw new Error("Requested range contains no selected GFS analysis cycles");
    if (chronological.length > MAX_HISTORICAL_BACKFILL_SELECTED_CYCLES) {
      throw new Error(
        `Requested backfill contains ${chronological.length} selected analyses, exceeding the planning limit ${MAX_HISTORICAL_BACKFILL_SELECTED_CYCLES}. Narrow the range or select fewer UTC cycles.`,
      );
    }

    const ordered = query.order === "newest_first" ? [...chronological].reverse() : chronological;
    const selectionKey = canonicalSelection(variables, pressureLevelsHpa);
    const existingRecords = await this.store.readAll();
    let gridPoint = inferGridPoint(existingRecords, query.latitude, query.longitude, selectionKey)
      ?? nearestGfsGrid4Point(query.latitude, query.longitude);
    let knownTimes = materializedTimes(existingRecords, gridPoint, selectionKey);
    let initialKnown = new Set(knownTimes);
    const initiallyMissing = ordered.filter((time) => !knownTimes.has(time.toISOString()));

    if (query.dryRun) {
      return result({
        query, variables, pressureLevelsHpa, cycleHoursUtc, gridPoint,
        selectedCycleCount: ordered.length,
        alreadyMaterialized: ordered.length - initiallyMissing.length,
        attempted: 0, cacheHits: 0, upstreamFetches: 0, materialized: 0,
        analysisTimesMaterialized: [], failures: [],
        remaining: initiallyMissing.length,
        nextAnalysisTime: initiallyMissing[0]?.toISOString() ?? null,
        status: "dry_run",
        indexPath: this.store.path,
      });
    }

    const fetchedRecords: HistoricalIndexRecord[] = [];
    const failures: HistoricalIndexBackfillResult["failures"] = [];
    let attempted = 0;
    let cacheHits = 0;
    let upstreamFetches = 0;
    let stoppedOnError = false;

    for (const analysisTime of ordered) {
      const iso = analysisTime.toISOString();
      if (knownTimes.has(iso)) continue;
      if (attempted >= query.maxFetches) break;
      attempted += 1;

      try {
        const profile = await this.profileGetter.getHistoricalProfile({
          latitude: query.latitude,
          longitude: query.longitude,
          analysisTime: iso,
          variables,
          pressureLevelsHpa,
        });
        if (profile.source.cacheHit) cacheHits += 1;
        else upstreamFetches += 1;

        if (!sameGridPoint(profile.gridPoint, gridPoint)) {
          // A half-grid tie can make a purely arithmetic nearest-cell guess differ
          // from NCSS. Trust the first real sample, then re-evaluate existing data.
          if (fetchedRecords.length > 0) {
            throw new Error("Historical GFS grid point changed within one backfill run");
          }
          gridPoint = profile.gridPoint;
          knownTimes = materializedTimes(existingRecords, gridPoint, selectionKey);
          initialKnown = new Set(knownTimes);
        }

        if (!knownTimes.has(profile.analysisTime)) {
          fetchedRecords.push(recordFromProfile(profile, variables, pressureLevelsHpa));
          knownTimes.add(profile.analysisTime);
        }
      } catch (error) {
        failures.push({ analysisTime: iso, message: errorMessage(error) });
        if (!query.continueOnError) {
          stoppedOnError = true;
          break;
        }
      }
    }

    const materialized = await this.store.append(fetchedRecords);
    const remainingTimes = ordered.filter((time) => !knownTimes.has(time.toISOString()));
    const status: HistoricalIndexBackfillResult["status"] = remainingTimes.length === 0
      ? "complete"
      : stoppedOnError
        ? "stopped_on_error"
        : failures.length > 0 && attempted < query.maxFetches
          ? "errors_remaining"
          : "budget_exhausted";

    return result({
      query, variables, pressureLevelsHpa, cycleHoursUtc, gridPoint,
      selectedCycleCount: ordered.length,
      alreadyMaterialized: ordered.filter((time) => initialKnown.has(time.toISOString())).length,
      attempted, cacheHits, upstreamFetches, materialized,
      analysisTimesMaterialized: fetchedRecords.map((record) => record.analysisTime),
      failures,
      remaining: remainingTimes.length,
      nextAnalysisTime: remainingTimes[0]?.toISOString() ?? null,
      status,
      indexPath: this.store.path,
    });
  }
}

interface ResultParts {
  query: ReturnType<typeof historicalIndexBackfillQuerySchema.parse>;
  variables: HistoricalGfsVariableId[];
  pressureLevelsHpa: number[];
  cycleHoursUtc: HistoricalCycleHourUtc[];
  gridPoint: { latitude: number; longitude: number };
  selectedCycleCount: number;
  alreadyMaterialized: number;
  attempted: number;
  cacheHits: number;
  upstreamFetches: number;
  materialized: number;
  analysisTimesMaterialized: string[];
  failures: HistoricalIndexBackfillResult["failures"];
  remaining: number;
  nextAnalysisTime: string | null;
  status: HistoricalIndexBackfillResult["status"];
  indexPath: string;
}

function result(parts: ResultParts): HistoricalIndexBackfillResult {
  return {
    model: "gfs_grid4_analysis_0p5",
    indexPath: parts.indexPath,
    requestedStartTime: new Date(parts.query.startTime).toISOString(),
    requestedEndTime: new Date(parts.query.endTime).toISOString(),
    requestedPoint: { latitude: parts.query.latitude, longitude: parts.query.longitude },
    gridPoint: parts.gridPoint,
    selection: {
      variables: parts.variables,
      pressureLevelsHpa: parts.pressureLevelsHpa,
      cycleHoursUtc: parts.cycleHoursUtc,
      order: parts.query.order,
    },
    selectedCycleCount: parts.selectedCycleCount,
    alreadyMaterialized: parts.alreadyMaterialized,
    fetchBudget: parts.query.maxFetches,
    attempted: parts.attempted,
    cacheHits: parts.cacheHits,
    upstreamFetches: parts.upstreamFetches,
    materialized: parts.materialized,
    analysisTimesMaterialized: parts.analysisTimesMaterialized,
    failures: parts.failures,
    remaining: parts.remaining,
    nextAnalysisTime: parts.nextAnalysisTime,
    status: parts.status,
    note: NOTE,
  };
}

function inferGridPoint(
  records: readonly HistoricalIndexRecord[],
  latitude: number,
  longitude: number,
  selectionKey: string,
) {
  return records.find((record) =>
    canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa) === selectionKey
    && Math.abs(record.requestedPoint.latitude - latitude) < 1e-9
    && circularLongitudeDifference(record.requestedPoint.longitude, longitude) < 1e-9
  )?.gridPoint;
}

function materializedTimes(
  records: readonly HistoricalIndexRecord[],
  gridPoint: { latitude: number; longitude: number },
  selectionKey: string,
): Set<string> {
  return new Set(records.filter((record) =>
    sameGridPoint(record.gridPoint, gridPoint)
    && canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa) === selectionKey
  ).map((record) => record.analysisTime));
}

function recordFromProfile(
  profile: HistoricalProfileResult,
  variables: HistoricalGfsVariableId[],
  pressureLevelsHpa: number[],
): HistoricalIndexRecord {
  return {
    version: 1,
    model: "gfs_grid4_analysis_0p5",
    analysisTime: profile.analysisTime,
    requestedPoint: profile.requestedPoint,
    gridPoint: profile.gridPoint,
    selection: { variables, pressureLevelsHpa },
    levels: profile.levels,
    source: {
      provider: profile.source.provider,
      access: profile.source.access,
      dataset: profile.source.dataset,
    },
  };
}

export function nearestGfsGrid4Point(latitude: number, longitude: number) {
  const roundedLatitude = Math.max(-90, Math.min(90, Math.round(latitude * 2) / 2));
  const lon360 = ((longitude % 360) + 360) % 360;
  const rounded360 = (Math.round(lon360 * 2) / 2) % 360;
  const normalizedLongitude = rounded360 >= 180 ? rounded360 - 360 : rounded360;
  return { latitude: roundedLatitude, longitude: normalizedLongitude };
}

function normalizeVariables(variables: readonly HistoricalGfsVariableId[]): HistoricalGfsVariableId[] {
  return [...new Set(variables)].sort();
}

function normalizeLevels(levels: readonly number[]): number[] {
  return [...new Set(levels)].sort((a, b) => b - a);
}

function circularLongitudeDifference(a: number, b: number): number {
  const normalize = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
  const delta = Math.abs(normalize(a) - normalize(b));
  return Math.min(delta, 360 - delta);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
