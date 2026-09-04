import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import {
  GEFS_PGRB2A_FIELD_CATALOG,
  type RawGefsFieldDefinition,
} from "../catalog/gefs-fields.js";
import { sortGefsMembers, type GefsMember } from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  Wgrib2GridDecoder,
  type GridValuePoint,
  type SelectedGridValues,
} from "../grib/wgrib2-grid.js";
import type { AreaBox, AreaMessageSelector, SelectedMessageTemporal } from "../grib/wgrib2-stats.js";
import {
  gefsAreaSummaryQuerySchema,
  gefsAreaSummaryResultSchema,
  type GefsAreaSummaryQueryInput,
  type GefsAreaSummaryResult,
} from "../schema/gefs-area-summary.js";
import type { GefsFieldTemporalResult } from "../schema/gefs-member-bundle.js";
import { computeAreaDistribution } from "./area-distribution.js";
import type { GribDecoderName } from "../types/decoded.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import { gefsAtmosProductForSelection, gefsAtmosProductGridDegrees, type GefsAtmosProduct } from "../sources/gefs-s3.js";

export interface GefsAreaGridDecoder {
  readonly engine?: GribDecoderName;
  extractBox(path: string, box: AreaBox): Promise<GridValuePoint[]>;
  extractSelectedMessage(path: string, box: AreaBox, selector: AreaMessageSelector): Promise<SelectedGridValues>;
}

export interface GefsAreaSummaryServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  gridDecoder?: GefsAreaGridDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

interface MemberAreaComputation {
  member: GefsMember;
  cacheHit: boolean;
  statistics: {
    definedGridPoints: number;
    mean: number;
    min: number;
    max: number;
  };
  distribution: ReturnType<typeof computeAreaDistribution>["distribution"];
  temporal?: SelectedMessageTemporal;
}

const GEFS_GRID_SPACING_DEG = 0.5;

export class GefsAreaSummaryService {
  private readonly source: GefsMemberSelectionSource;
  private readonly gridDecoder: GefsAreaGridDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsAreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.gridDecoder = options.gridDecoder ?? new Wgrib2GridDecoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async summarize(input: GefsAreaSummaryQueryInput): Promise<GefsAreaSummaryResult> {
    const query = gefsAreaSummaryQuerySchema.parse(input);
    const box: AreaBox = {
      westLongitude: query.westLongitude,
      eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude,
      northLatitude: query.northLatitude,
    };
    const members = sortGefsMembers(query.members);
    const validTime = new Date(query.validTime);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const product = gefsAtmosProductForSelection(query.field === undefined, forecastHour);
    const horizontalGridDegrees = gefsAtmosProductGridDegrees(product);
    const estimatedGridPoints = estimateGefsGridPoints(box, horizontalGridDegrees);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new Error(`Requested bbox is approximately ${estimatedGridPoints} GEFS grid points at ${horizontalGridDegrees}°, exceeding maxGridPoints=${query.maxGridPoints}`);
    }
    const estimatedMemberGridPoints = estimatedGridPoints * members.length;
    if (estimatedMemberGridPoints > query.maxMemberGridPoints) {
      throw new Error(`Requested bbox × member selection is approximately ${estimatedMemberGridPoints} member-grid points at ${horizontalGridDegrees}°, exceeding maxMemberGridPoints=${query.maxMemberGridPoints}`);
    }

    const memberComputations = query.field === undefined
      ? await this.summarizePressureMembers(query, box, run, forecastHour, members, product)
      : await this.summarizeFieldMembers(query, box, run, forecastHour, members, product);

    const outputDefinition = query.field === undefined
      ? pressureOutput(query.variable!)
      : fieldOutput(query.field);
    const temporal = sharedTemporal(memberComputations, run);

    const result = {
      model: "gefs_0p50" as const,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      bbox: box,
      selection: {
        ...(query.field === undefined
          ? { variable: query.variable!, pressureLevelHpa: query.pressureLevelHpa! }
          : { field: query.field, ...(temporal === undefined ? {} : { temporal }) }),
        outputField: outputDefinition.field,
        unit: outputDefinition.unit,
        members,
        quantiles,
      },
      methodology: "spatial_statistics_per_member_then_ensemble_distribution" as const,
      statistics: {
        definedGridPoints: summarizeNumericDistribution(memberComputations.map((member) => member.statistics.definedGridPoints), quantiles),
        mean: summarizeNumericDistribution(memberComputations.map((member) => member.statistics.mean), quantiles),
        min: summarizeNumericDistribution(memberComputations.map((member) => member.statistics.min), quantiles),
        max: summarizeNumericDistribution(memberComputations.map((member) => member.statistics.max), quantiles),
      },
      ...spatialPercentileSummaries(memberComputations, query.percentiles, quantiles),
      ...spatialThresholdSummaries(memberComputations, query.thresholds, quantiles),
      ...(query.includeExtremaLocations ? { memberExtrema: memberExtrema(memberComputations) } : {}),
      ...(query.includeMembers ? { members: publicMembers(memberComputations) } : {}),
      source: {
        provider: "NOAA AWS Open Data" as const,
        access: "s3_range" as const,
        decoder: this.gridDecoder.engine ?? "wgrib2",
        product,
        horizontalGridDegrees,
        allCacheHit: memberComputations.every((member) => member.cacheHit),
      },
    };
    return gefsAreaSummaryResultSchema.parse(result);
  }

  private async summarizePressureMembers(
    query: ReturnType<typeof gefsAreaSummaryQuerySchema.parse>,
    box: AreaBox,
    run: Date,
    forecastHour: number,
    members: GefsMember[],
    product: GefsAtmosProduct,
  ): Promise<MemberAreaComputation[]> {
    const variable = VARIABLE_CATALOG[query.variable!] as RawVariableDefinition;
    return mapConcurrent(members, this.concurrency, async (member) => {
      const file = await this.source.fetchSelection({
        run,
        forecastHour,
        member,
        variableCodes: [variable.gfsCode],
        pressureLevelsHpa: [query.pressureLevelHpa!],
        fields: [],
        product,
      });
      const rawPoints = await this.gridDecoder.extractBox(file.path, box);
      const points = normalizePoints(rawPoints, (value) => normalizePressureValue(variable, value));
      const computed = computeAreaDistribution(points, query);
      return { member, cacheHit: file.cacheHit, ...computed };
    });
  }

  private async summarizeFieldMembers(
    query: ReturnType<typeof gefsAreaSummaryQuerySchema.parse>,
    box: AreaBox,
    run: Date,
    forecastHour: number,
    members: GefsMember[],
    product: GefsAtmosProduct,
  ): Promise<MemberAreaComputation[]> {
    const definition = GEFS_PGRB2A_FIELD_CATALOG[query.field!] as RawGefsFieldDefinition;
    const selector: AreaMessageSelector = {
      code: definition.gfsCode as AreaMessageSelector["code"],
      gribLevel: definition.level.gribLevel,
      temporalSemantics: definition.temporalSemantics,
    };
    return mapConcurrent(members, this.concurrency, async (member) => {
      const file = await this.source.fetchSelection({
        run,
        forecastHour,
        member,
        variableCodes: [],
        pressureLevelsHpa: [],
        fields: [definition],
        product,
      });
      const extracted = await this.gridDecoder.extractSelectedMessage(file.path, box, selector);
      const points = normalizePoints(extracted.points, (value) => normalizeFieldValue(definition, value));
      const computed = computeAreaDistribution(points, query);
      return { member, cacheHit: file.cacheHit, ...computed, temporal: extracted.temporal };
    });
  }
}

export function estimateGefsGridPoints(box: AreaBox, gridSpacingDeg = GEFS_GRID_SPACING_DEG): number {
  const longitudePoints = Math.ceil((box.eastLongitude - box.westLongitude) / gridSpacingDeg) + 2;
  const latitudePoints = Math.ceil((box.northLatitude - box.southLatitude) / gridSpacingDeg) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function pressureOutput(variableId: NonNullable<ReturnType<typeof gefsAreaSummaryQuerySchema.parse>["variable"]>) {
  const output = VARIABLE_CATALOG[variableId].outputs[0];
  if (!output) throw new Error(`GEFS area variable ${variableId} has no output definition`);
  return output;
}

function fieldOutput(fieldId: NonNullable<ReturnType<typeof gefsAreaSummaryQuerySchema.parse>["field"]>) {
  const output = GEFS_PGRB2A_FIELD_CATALOG[fieldId].outputs[0];
  if (!output) throw new Error(`GEFS area field ${fieldId} has no output definition`);
  return output;
}

function normalizePoints(points: readonly GridValuePoint[], normalize: (value: number) => number): GridValuePoint[] {
  return points.map((point) => ({ ...point, value: normalize(point.value) }));
}

function normalizePressureValue(definition: RawVariableDefinition, value: number): number {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function normalizeFieldValue(definition: RawGefsFieldDefinition, value: number): number {
  const output = definition.outputs[0];
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}

function sharedTemporal(computations: readonly MemberAreaComputation[], run: Date): GefsFieldTemporalResult | undefined {
  const values = computations.map((member) => member.temporal).filter((value): value is SelectedMessageTemporal => value !== undefined);
  if (values.length === 0) return undefined;
  const first = values[0]!;
  for (const value of values) {
    if (JSON.stringify(value) !== JSON.stringify(first)) {
      throw new Error("GEFS area field has inconsistent temporal intervals across members");
    }
  }
  if (first.type === "instantaneous") return first;
  return {
    ...first,
    startTime: new Date(run.getTime() + first.startForecastHour * 3_600_000).toISOString(),
    endTime: new Date(run.getTime() + first.endForecastHour * 3_600_000).toISOString(),
  };
}

function spatialPercentileSummaries(
  members: readonly MemberAreaComputation[],
  percentiles: readonly number[] | undefined,
  quantiles: readonly number[],
) {
  if (!percentiles || percentiles.length === 0) return {};
  return {
    spatialPercentiles: percentiles.map((percentile, index) => ({
      percentile,
      percentileMethod: "linear_interpolation_sorted_defined_grid_points" as const,
      distribution: summarizeNumericDistribution(members.map((member) => member.distribution.percentiles?.[index]?.value ?? missing(`spatial percentile ${percentile}`)), quantiles),
    })),
  };
}

function spatialThresholdSummaries(
  members: readonly MemberAreaComputation[],
  thresholds: readonly { operator: "gte" | "lte"; value: number }[] | undefined,
  quantiles: readonly number[],
) {
  if (!thresholds || thresholds.length === 0) return {};
  return {
    spatialThresholdFractions: thresholds.map((threshold, index) => ({
      operator: threshold.operator,
      threshold: threshold.value,
      distribution: summarizeNumericDistribution(members.map((member) => member.distribution.thresholdFractions?.[index]?.fraction ?? missing(`spatial threshold ${threshold.operator} ${threshold.value}`)), quantiles),
      interpretation: "distribution_of_raw_member_spatial_fractions_not_calibrated_probability" as const,
    })),
  };
}

function memberExtrema(members: readonly MemberAreaComputation[]) {
  return members.map((member) => {
    if (!member.distribution.extrema) throw new Error(`GEFS area member ${member.member} is missing requested extrema`);
    return { member: member.member, ...member.distribution.extrema };
  });
}

function publicMembers(members: readonly MemberAreaComputation[]) {
  return members.map((member) => ({
    member: member.member,
    cacheHit: member.cacheHit,
    statistics: member.statistics,
    ...(member.distribution.percentiles === undefined ? {} : { percentiles: member.distribution.percentiles }),
    ...(member.distribution.thresholdFractions === undefined ? {} : { thresholdFractions: member.distribution.thresholdFractions }),
    ...(member.distribution.extrema === undefined ? {} : { extrema: member.distribution.extrema }),
  }));
}

function missing(context: string): never {
  throw new Error(`Internal GEFS area aggregation is missing ${context}`);
}
