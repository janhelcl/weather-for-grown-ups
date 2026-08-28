import { ifsIndexSelectorsForSelection, IfsProfileService } from "./ifs-profile.js";
import { IfsLatestRunResolver, type IfsLatestRunProvider } from "./ifs-latest-run.js";
import { parseIfsRun } from "./ifs-time.js";
import { mapConcurrent } from "./concurrency.js";
import { circularDegreeDelta } from "./run-comparison.js";
import {
  ifsRunComparisonQuerySchema,
  ifsRunComparisonResultSchema,
  type IfsRunComparisonQueryInput,
  type IfsRunComparisonResult,
} from "../schema/ifs-run-comparison.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import type {
  FieldTemporalResult,
  GridPoint,
  NonIsobaricFieldResult,
  ProfileLevel,
} from "./types.js";

const IFS_CYCLE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_IFS_RUN_COMPARISON_CONCURRENCY = 3;

export interface IfsRunComparisonProfileGetter {
  getProfile(query: IfsPointQueryInput): Promise<IfsProfileResult>;
}

export interface IfsRunComparisonServiceOptions {
  profileGetter?: IfsRunComparisonProfileGetter;
  latestRunProvider?: IfsLatestRunProvider;
  concurrency?: number;
}

export class IfsRunComparisonService {
  private readonly profileGetter: IfsRunComparisonProfileGetter;
  private readonly latestRunProvider: IfsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsRunComparisonServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new IfsLatestRunResolver();
    this.profileGetter = options.profileGetter ?? new IfsProfileService({
      latestRunProvider: this.latestRunProvider,
    });
    this.concurrency = options.concurrency ?? DEFAULT_IFS_RUN_COMPARISON_CONCURRENCY;
  }

  async compareRuns(input: IfsRunComparisonQueryInput): Promise<IfsRunComparisonResult> {
    const query = ifsRunComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const selectors = ifsIndexSelectorsForSelection({
      variables: query.variables,
      pressureLevelsHpa: query.pressureLevelsHpa,
      fields: query.fields,
    });

    const anchorRun = query.anchorRun === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, selectors)
      : parseIfsRun(query.anchorRun);

    const runs = Array.from({ length: query.cycles }, (_, index) =>
      new Date(anchorRun.getTime() - (query.cycles - 1 - index) * IFS_CYCLE_MS));

    const profiles = await mapConcurrent(runs, this.concurrency, async (run) => {
      try {
        return await this.profileGetter.getProfile({
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime: validTime.toISOString(),
          ...(query.variables === undefined ? {} : { variables: query.variables }),
          ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
          ...(query.fields === undefined ? {} : { fields: query.fields }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot compare IFS run ${run.toISOString()} at ${validTime.toISOString()}: ${message}`,
        );
      }
    });

    const first = profiles[0];
    if (!first) throw new Error("IFS run comparison produced no profiles");

    for (const [index, profile] of profiles.entries()) {
      assertSnapshotInvariant(
        profile,
        runs[index]!.toISOString(),
        validTime.toISOString(),
        query.latitude,
        query.longitude,
        first.gridPoint,
        first.source.decoder,
      );
    }

    return ifsRunComparisonResultSchema.parse({
      model: "ifs_0p25",
      validTime: validTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      anchorRun: anchorRun.toISOString(),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.source.decoder,
        product: "ifs_0p25_oper_fc",
        horizontalGridDegrees: 0.25,
      },
      runs: profiles.map((profile) => ({
        run: profile.run,
        forecastHour: profile.forecastHour,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
        cacheHit: profile.source.cacheHit,
      })),
      comparisons: profiles.slice(1).map((newer, index) =>
        compareProfiles(profiles[index]!, newer)),
    });
  }
}

function assertSnapshotInvariant(
  profile: IfsProfileResult,
  expectedRun: string,
  expectedValidTime: string,
  latitude: number,
  longitude: number,
  gridPoint: GridPoint,
  expectedDecoder: "gribberish" | "wgrib2",
): void {
  if (profile.run !== expectedRun) {
    throw new Error(`IFS profile service changed requested comparison run from ${expectedRun} to ${profile.run}`);
  }
  if (profile.validTime !== expectedValidTime) {
    throw new Error("IFS profile service changed valid time within one run comparison");
  }
  if (
    profile.requestedPoint.latitude !== latitude
    || profile.requestedPoint.longitude !== longitude
  ) {
    throw new Error("IFS profile service changed requested point within one run comparison");
  }
  if (
    profile.gridPoint.latitude !== gridPoint.latitude
    || profile.gridPoint.longitude !== gridPoint.longitude
  ) {
    throw new Error("IFS grid point changed across model cycles for one run comparison");
  }
  if (
    profile.source.provider !== "ECMWF Open Data"
    || profile.source.access !== "indexed_http_range"
    || profile.source.decoder !== expectedDecoder
    || profile.source.product !== "ifs_0p25_oper_fc"
    || profile.source.horizontalGridDegrees !== 0.25
  ) {
    throw new Error("IFS run comparison requires the ECMWF indexed byte-range source");
  }
}

function compareProfiles(
  older: IfsProfileResult,
  newer: IfsProfileResult,
): {
  fromRun: string;
  toRun: string;
  fromForecastHour: number;
  toForecastHour: number;
  pressureLevels: Array<{ pressureHpa: number; changes: NumericChange[] }>;
  fields: Array<{
    id: string;
    comparable: boolean;
    reason?: "field_missing_in_one_run" | "vertical_semantics_differ" | "temporal_windows_differ";
    changes: NumericChange[];
  }>;
} {
  const olderLevels = new Map(older.levels.map((level) => [level.pressureHpa, level]));
  const newerLevels = new Map(newer.levels.map((level) => [level.pressureHpa, level]));
  const pressures = [...new Set([...olderLevels.keys(), ...newerLevels.keys()])]
    .sort((a, b) => b - a);

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
        olderLevels.get(pressureHpa) as ProfileLevel | undefined,
        newerLevels.get(pressureHpa) as ProfileLevel | undefined,
        new Set(["pressureHpa"]),
      ),
    })),
    fields: fieldIds.map((id) =>
      compareField(
        id,
        olderFields.get(id) as NonIsobaricFieldResult | undefined,
        newerFields.get(id) as NonIsobaricFieldResult | undefined,
      )),
  };
}

type NumericChange = {
  field: string;
  from: number;
  to: number;
  delta: number;
  deltaKind: "linear" | "circular_degrees";
};

function compareField(
  id: string,
  older: NonIsobaricFieldResult | undefined,
  newer: NonIsobaricFieldResult | undefined,
): {
  id: string;
  comparable: boolean;
  reason?: "field_missing_in_one_run" | "vertical_semantics_differ" | "temporal_windows_differ";
  changes: NumericChange[];
} {
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

function temporalSemanticsComparable(
  older: FieldTemporalResult,
  newer: FieldTemporalResult,
): boolean {
  if (older.type !== newer.type) return false;
  if (older.type === "instantaneous" && newer.type === "instantaneous") return true;
  if (older.type === "instantaneous" || newer.type === "instantaneous") return false;
  return older.startTime === newer.startTime && older.endTime === newer.endTime;
}

function compareNumericRecords(
  older: object | undefined,
  newer: object | undefined,
  ignored = new Set<string>(),
): NumericChange[] {
  if (!older || !newer) return [];
  const olderRecord = older as Record<string, unknown>;
  const newerRecord = newer as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(olderRecord), ...Object.keys(newerRecord)])]
    .filter((key) => !ignored.has(key))
    .sort();

  const changes: NumericChange[] = [];
  for (const field of keys) {
    const from = olderRecord[field];
    const to = newerRecord[field];
    if (
      typeof from !== "number"
      || typeof to !== "number"
      || !Number.isFinite(from)
      || !Number.isFinite(to)
    ) continue;
    const deltaKind = /direction.*deg/i.test(field)
      ? "circular_degrees" as const
      : "linear" as const;
    changes.push({
      field,
      from,
      to,
      delta: deltaKind === "circular_degrees"
        ? circularDegreeDelta(from, to)
        : to - from,
      deltaKind,
    });
  }
  return changes;
}
