import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import {
  runComparisonQuerySchema,
  type ProfileQueryInput,
  type RunComparisonQueryInput,
} from "../schema/query.js";
import { mapConcurrent } from "./concurrency.js";
import { parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import { ProfileService } from "./profile.js";
import type {
  FieldTemporalResult,
  GridPoint,
  NonIsobaricFieldResult,
  ProfileLevel,
  ProfileResult,
} from "./types.js";

const GFS_CYCLE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_RUN_COMPARISON_CONCURRENCY = 4;

export type DeltaKind = "linear" | "circular_degrees";

export interface NumericChange {
  field: string;
  from: number;
  to: number;
  delta: number;
  deltaKind: DeltaKind;
}

export interface PressureLevelChange {
  pressureHpa: number;
  changes: NumericChange[];
}

export interface NonIsobaricFieldChange {
  id: string;
  comparable: boolean;
  reason?: string;
  changes: NumericChange[];
}

export interface RunComparisonSnapshot {
  run: string;
  forecastHour: number;
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
  cacheHit: boolean;
}

export interface RunComparisonTransition {
  fromRun: string;
  toRun: string;
  fromForecastHour: number;
  toForecastHour: number;
  pressureLevels: PressureLevelChange[];
  fields: NonIsobaricFieldChange[];
}

export interface RunComparisonResult {
  model: "gfs_0p25";
  validTime: string;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  anchorRun: string;
  source: {
    provider: "NOAA AWS Open Data";
    access: "s3_range";
    decoder: "wgrib2";
  };
  runs: RunComparisonSnapshot[];
  comparisons: RunComparisonTransition[];
}

export interface RunComparisonProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface RunComparisonServiceOptions {
  profileGetter?: RunComparisonProfileGetter;
  latestRunProvider?: LatestRunProvider;
  concurrency?: number;
}

/**
 * Compare consecutive six-hour GFS cycles at one point and one valid time.
 *
 * Runs are returned oldest → newest. Every comparison is a consecutive
 * transition and every delta is `newer - older`. The service is S3-only so
 * several model cycles can be fetched concurrently without consuming NOMADS
 * courtesy-limiter slots.
 */
export class RunComparisonService {
  private readonly profileGetter: RunComparisonProfileGetter;
  private readonly latestRunProvider: LatestRunProvider;
  private readonly concurrency: number;

  constructor(options: RunComparisonServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.profileGetter = options.profileGetter ?? new ProfileService({
      latestRunProvider: this.latestRunProvider,
    });
    this.concurrency = options.concurrency ?? DEFAULT_RUN_COMPARISON_CONCURRENCY;
  }

  async compareRuns(input: RunComparisonQueryInput): Promise<RunComparisonResult> {
    const query = runComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const variables = expandRequestedVariables(query.variables ?? []);
    const fields = expandRequestedFields(query.fields ?? []);
    const pressureLevelsHpa = query.pressureLevelsHpa ?? [];

    const anchorRun = query.anchorRun === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        })
      : query.anchorRun === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun()
        : parseGfsRun(query.anchorRun);

    const runs = Array.from({ length: query.cycles }, (_, index) =>
      new Date(anchorRun.getTime() - (query.cycles - 1 - index) * GFS_CYCLE_MS));

    const profiles = await mapConcurrent(
      runs,
      this.concurrency,
      async (run) => {
        try {
          return await this.profileGetter.getProfile({
            latitude: query.latitude,
            longitude: query.longitude,
            run: run.toISOString(),
            validTime: validTime.toISOString(),
            ...(query.variables === undefined ? {} : { variables: query.variables }),
            ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
            ...(query.fields === undefined ? {} : { fields: query.fields }),
            source: "s3",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Cannot compare GFS run ${run.toISOString()} at ${validTime.toISOString()}: ${message}`);
        }
      },
    );

    const first = profiles[0];
    if (!first) throw new Error("Run comparison produced no profiles");

    for (const [index, profile] of profiles.entries()) {
      const expectedRun = runs[index]!.toISOString();
      assertSnapshotInvariant(profile, expectedRun, validTime.toISOString(), query.latitude, query.longitude, first.gridPoint);
    }

    const snapshots: RunComparisonSnapshot[] = profiles.map((profile) => ({
      run: profile.run,
      forecastHour: profile.forecastHour,
      levels: profile.levels,
      ...(profile.fields === undefined ? {} : { fields: profile.fields }),
      cacheHit: profile.source.cacheHit,
    }));

    return {
      model: "gfs_0p25",
      validTime: validTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      anchorRun: anchorRun.toISOString(),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
      },
      runs: snapshots,
      comparisons: profiles.slice(1).map((newer, index) => compareProfiles(profiles[index]!, newer)),
    };
  }
}

function assertSnapshotInvariant(
  profile: ProfileResult,
  expectedRun: string,
  expectedValidTime: string,
  latitude: number,
  longitude: number,
  gridPoint: GridPoint,
): void {
  if (profile.run !== expectedRun) throw new Error(`Profile service changed requested comparison run from ${expectedRun} to ${profile.run}`);
  if (profile.validTime !== expectedValidTime) throw new Error("Profile service changed valid time within one run comparison");
  if (profile.requestedPoint.latitude !== latitude || profile.requestedPoint.longitude !== longitude) {
    throw new Error("Profile service changed requested point within one run comparison");
  }
  if (profile.gridPoint.latitude !== gridPoint.latitude || profile.gridPoint.longitude !== gridPoint.longitude) {
    throw new Error("GFS grid point changed across model cycles for one run comparison");
  }
  if (
    profile.source.provider !== "NOAA AWS Open Data"
    || profile.source.access !== "s3_range"
    || profile.source.decoder !== "wgrib2"
  ) {
    throw new Error("Run comparison requires the NOAA AWS S3 byte-range source");
  }
}

function compareProfiles(older: ProfileResult, newer: ProfileResult): RunComparisonTransition {
  const olderLevels = new Map(older.levels.map((level) => [level.pressureHpa, level]));
  const newerLevels = new Map(newer.levels.map((level) => [level.pressureHpa, level]));
  const pressures = [...new Set([...olderLevels.keys(), ...newerLevels.keys()])].sort((a, b) => b - a);

  const olderFields = new Map((older.fields ?? []).map((field) => [field.id, field]));
  const newerFields = new Map((newer.fields ?? []).map((field) => [field.id, field]));
  const fieldIds = [...new Set([...olderFields.keys(), ...newerFields.keys()])];

  return {
    fromRun: older.run,
    toRun: newer.run,
    fromForecastHour: older.forecastHour,
    toForecastHour: newer.forecastHour,
    pressureLevels: pressures.map((pressureHpa) => ({
      pressureHpa,
      changes: compareNumericRecords(
        olderLevels.get(pressureHpa),
        newerLevels.get(pressureHpa),
        new Set(["pressureHpa"]),
      ),
    })),
    fields: fieldIds.map((id) => compareField(id, olderFields.get(id), newerFields.get(id))),
  };
}

function compareField(
  id: string,
  older: NonIsobaricFieldResult | undefined,
  newer: NonIsobaricFieldResult | undefined,
): NonIsobaricFieldChange {
  if (!older || !newer) {
    return { id, comparable: false, reason: "field_missing_in_one_run", changes: [] };
  }
  if (JSON.stringify(older.level) !== JSON.stringify(newer.level)) {
    return { id, comparable: false, reason: "vertical_semantics_differ", changes: [] };
  }
  if (!temporalSemanticsComparable(older.temporal, newer.temporal)) {
    return { id, comparable: false, reason: "temporal_windows_differ", changes: [] };
  }
  return {
    id,
    comparable: true,
    changes: compareNumericRecords(older.values, newer.values),
  };
}

function temporalSemanticsComparable(older: FieldTemporalResult, newer: FieldTemporalResult): boolean {
  if (older.type !== newer.type) return false;
  if (older.type === "instantaneous" && newer.type === "instantaneous") return true;
  if (older.type === "instantaneous" || newer.type === "instantaneous") return false;
  return older.startTime === newer.startTime && older.endTime === newer.endTime;
}

function compareNumericRecords(
  older: Record<string, unknown> | undefined,
  newer: Record<string, unknown> | undefined,
  ignored = new Set<string>(),
): NumericChange[] {
  if (!older || !newer) return [];
  const keys = [...new Set([...Object.keys(older), ...Object.keys(newer)])]
    .filter((key) => !ignored.has(key))
    .sort();

  const changes: NumericChange[] = [];
  for (const field of keys) {
    const from = older[field];
    const to = newer[field];
    if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const deltaKind: DeltaKind = isDirectionDegrees(field) ? "circular_degrees" : "linear";
    changes.push({
      field,
      from,
      to,
      delta: deltaKind === "circular_degrees" ? circularDegreeDelta(from, to) : to - from,
      deltaKind,
    });
  }
  return changes;
}

function isDirectionDegrees(field: string): boolean {
  return /direction.*deg/i.test(field);
}

export function circularDegreeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}
