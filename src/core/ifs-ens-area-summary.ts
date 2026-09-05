import { homedir } from "node:os";
import { join } from "node:path";
import {
  IfsOpenDataSubsetCache,
  type IfsSelectionSource,
} from "../cache/ifs-open-data-cache.js";
import {
  IFS_FIELD_CATALOG,
  IFS_RAW_PRESSURE_VARIABLE_CATALOG,
  type IfsRawFieldId,
  type IfsRawPressureVariableId,
} from "../catalog/ifs.js";
import {
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
  type IfsEnsMember,
} from "../catalog/ifs-ens.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricLevel,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  gridPointsInBox,
  readGribMessages,
  type GribBox,
  type GribGridPoint,
} from "../grib/gribberish-runtime.js";
import {
  ifsEnsAreaSummaryQuerySchema,
  ifsEnsAreaSummaryResultSchema,
  type IfsEnsAreaSummaryQueryInput,
  type IfsEnsAreaSummaryResult,
} from "../schema/ifs-ens-area-summary.js";
import type {
  FieldTemporalResult,
  NonIsobaricFieldLevelResult,
} from "./types.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import { computeAreaDistribution } from "./area-distribution.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRunProvider,
} from "./ifs-ens-latest-run.js";
import { DEFAULT_IFS_ENS_MEMBER_CONCURRENCY } from "./ifs-ens-member-bundle.js";
import { IfsEnsMemberSelectionSource } from "./ifs-ens-member-source.js";
import { estimateIfsGridPoints } from "./ifs-area-summary.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";
import { InvalidRequestError } from "../failure.js";

const HOUR_MS = 3_600_000;

export interface IfsEnsAreaGridDecoder {
  readonly engine?: "gribberish";
  extractBox(path: string, box: GribBox): Promise<GribGridPoint[]>;
}

export interface IfsEnsAreaSummaryServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  decoder?: IfsEnsAreaGridDecoder;
  latestRunProvider?: IfsEnsLatestRunProvider;
  concurrency?: number;
}

interface MemberAreaComputation {
  member: IfsEnsMember;
  cacheHit: boolean;
  statistics: {
    definedGridPoints: number;
    mean: number;
    min: number;
    max: number;
  };
  distribution: ReturnType<typeof computeAreaDistribution>["distribution"];
}

export class IfsEnsAreaSummaryService {
  private readonly source: IfsSelectionSource;
  private readonly decoder: IfsEnsAreaGridDecoder;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsEnsAreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.decoder = options.decoder ?? new BundledIfsEnsAreaGridDecoder();
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver({ cacheDir });
    this.concurrency = options.concurrency ?? DEFAULT_IFS_ENS_MEMBER_CONCURRENCY;
  }

  async summarize(input: IfsEnsAreaSummaryQueryInput): Promise<IfsEnsAreaSummaryResult> {
    const query = ifsEnsAreaSummaryQuerySchema.parse(input);
    const box: GribBox = {
      westLongitude: query.westLongitude,
      eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude,
      northLatitude: query.northLatitude,
    };
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const estimatedGridPoints = estimateIfsGridPoints(box);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new InvalidRequestError(
        `Requested bbox is approximately ${estimatedGridPoints} IFS ENS grid points at 0.25°, exceeding maxGridPoints=${query.maxGridPoints}`,
      );
    }
    const estimatedMemberGridPoints = estimatedGridPoints * members.length;
    if (estimatedMemberGridPoints > query.maxMemberGridPoints) {
      throw new InvalidRequestError(
        `Requested bbox × perturbation selection is approximately ${estimatedMemberGridPoints} member-grid points at 0.25°, exceeding maxMemberGridPoints=${query.maxMemberGridPoints}`,
      );
    }

    const spec = buildScalarSpec(query);
    const validTime = new Date(query.validTime);
    const availabilitySelectors = members.map((member) => ({
      ...spec.selector,
      number: ifsEnsMemberNumber(member),
    }));
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, availabilitySelectors)
      : parseIfsRun(query.run);
    const forecastHour = ifsEnsForecastHour(run, validTime);

    const memberComputations = await mapConcurrent(
      members,
      this.concurrency,
      async (member): Promise<MemberAreaComputation> => {
        const memberSource = new IfsEnsMemberSelectionSource(this.source, ifsEnsMemberNumber(member));
        const sourceForecastHour = spec.selector.sourceForecastHour ?? forecastHour;
        const file = await memberSource.fetchSelection({
          run,
          forecastHour: sourceForecastHour,
          selectors: [spec.selector],
        });
        const rawPoints = await this.decoder.extractBox(file.path, box);
        const points = spec.kind === "pressure"
          ? normalizePressurePoints(rawPoints, spec.variable)
          : normalizeFieldPoints(rawPoints, spec.field);
        const computed = computeAreaDistribution(points, query);
        return {
          member,
          cacheHit: file.cacheHit,
          statistics: computed.statistics,
          distribution: computed.distribution,
        };
      },
    );

    const selection = spec.kind === "pressure"
      ? {
          variable: spec.variable,
          pressureLevelHpa: spec.pressureLevelHpa,
          outputField: spec.outputField,
          unit: spec.unit,
          members,
          quantiles,
        }
      : {
          field: spec.field,
          level: publicLevel(spec.level),
          temporal: publicTemporal(spec.temporalSemantics, run, forecastHour),
          outputField: spec.outputField,
          unit: spec.unit,
          members,
          quantiles,
        };

    return ifsEnsAreaSummaryResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      bbox: box,
      selection,
      methodology: "spatial_statistics_per_member_then_ensemble_distribution",
      statistics: {
        definedGridPoints: summarizeNumericDistribution(
          memberComputations.map((member) => member.statistics.definedGridPoints),
          quantiles,
        ),
        mean: summarizeNumericDistribution(
          memberComputations.map((member) => member.statistics.mean),
          quantiles,
        ),
        min: summarizeNumericDistribution(
          memberComputations.map((member) => member.statistics.min),
          quantiles,
        ),
        max: summarizeNumericDistribution(
          memberComputations.map((member) => member.statistics.max),
          quantiles,
        ),
      },
      ...spatialPercentileSummaries(memberComputations, query.percentiles, quantiles),
      ...spatialThresholdSummaries(memberComputations, query.thresholds, quantiles),
      ...(query.includeExtremaLocations ? { memberExtrema: memberExtrema(memberComputations) } : {}),
      ...(query.includeMembers ? { members: publicMembers(memberComputations) } : {}),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: "gribberish",
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: memberComputations.every((member) => member.cacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
        ...(spec.selector.sourceForecastHour === undefined
          ? {}
          : { sharedRunStaticProduct: "ifs_0p25_oper_fc" }),
      },
    });
  }
}

type ScalarSpec =
  | {
      kind: "pressure";
      variable: NonNullable<ReturnType<typeof ifsEnsAreaSummaryQuerySchema.parse>["variable"]>;
      pressureLevelHpa: number;
      selector: IfsIndexSelector;
      outputField: string;
      unit: string;
    }
  | {
      kind: "field";
      field: NonNullable<ReturnType<typeof ifsEnsAreaSummaryQuerySchema.parse>["field"]>;
      selector: IfsIndexSelector;
      outputField: string;
      unit: string;
      level: NonIsobaricLevel;
      temporalSemantics: "instantaneous" | "accumulation";
    };

function buildScalarSpec(
  query: ReturnType<typeof ifsEnsAreaSummaryQuerySchema.parse>,
): ScalarSpec {
  if (query.field === undefined) {
    if (query.variable === undefined || query.pressureLevelHpa === undefined) {
      throw new Error("Internal IFS ENS area pressure selection is incomplete");
    }
    const rawId: IfsRawPressureVariableId =
      query.variable === "absolute_vorticity" ? "relative_vorticity" : query.variable;
    const definition = IFS_RAW_PRESSURE_VARIABLE_CATALOG[rawId];
    const output = VARIABLE_CATALOG[query.variable].outputs[0];
    if (!output) throw new Error(`IFS ENS area variable ${query.variable} has no output definition`);
    return {
      kind: "pressure",
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      selector: {
        key: `${query.variable}@${query.pressureLevelHpa}`,
        param: definition.param,
        levtype: "pl",
        levelist: query.pressureLevelHpa,
      },
      outputField: output.field,
      unit: output.unit,
    };
  }

  const definition = IFS_FIELD_CATALOG[query.field];
  if (definition.kind !== "raw") {
    throw new Error(`IFS ENS area summary supports raw fields only; ${query.field} is derived`);
  }
  const canonical = NON_ISOBARIC_FIELD_CATALOG[query.field];
  const output = canonical.outputs[0];
  if (!output) throw new Error(`IFS ENS area field ${query.field} has no output definition`);
  return {
    kind: "field",
    field: query.field,
    selector: {
      key: query.field,
      param: definition.param,
      levtype: definition.levtype,
      ...(definition.sourceForecastHour === undefined
        ? {}
        : { sourceForecastHour: definition.sourceForecastHour }),
    },
    outputField: output.field,
    unit: output.unit,
    level: canonical.level,
    temporalSemantics: definition.temporalSemantics,
  };
}

class BundledIfsEnsAreaGridDecoder implements IfsEnsAreaGridDecoder {
  readonly engine = "gribberish" as const;

  async extractBox(path: string, box: GribBox): Promise<GribGridPoint[]> {
    const messages = await readGribMessages(path);
    if (messages.length !== 1) {
      throw new Error(`IFS ENS area decoder expected one selected GRIB message, found ${messages.length}`);
    }
    return gridPointsInBox(messages[0]!, box);
  }
}

function normalizePressurePoints(
  points: readonly GribGridPoint[],
  id: NonNullable<ReturnType<typeof ifsEnsAreaSummaryQuerySchema.parse>["variable"]>,
): GribGridPoint[] {
  if (id === "temperature") {
    return points.map((point) => ({ ...point, value: point.value - 273.15 }));
  }
  if (id === "absolute_vorticity") {
    return points.map((point) => ({
      ...point,
      value: point.value + coriolisParameterS1(point.latitude),
    }));
  }
  return [...points];
}

function normalizeFieldPoints(
  points: readonly GribGridPoint[],
  id: IfsRawFieldId,
): GribGridPoint[] {
  return points.map((point) => ({
    ...point,
    value: normalizeFieldValue(id, point.value),
  }));
}

function normalizeFieldValue(id: IfsRawFieldId, value: number): number {
  const definition = IFS_FIELD_CATALOG[id];
  if (definition.kind !== "raw") throw new Error(`Internal IFS ENS raw-field normalization error for ${id}`);
  const output = NON_ISOBARIC_FIELD_CATALOG[id].outputs[0];
  if (!output) throw new Error(`IFS ENS field ${id} has no public output`);
  if (definition.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  if (definition.sourceUnit === "m" && output.unit === "mm") return value * 1_000;
  if (definition.sourceUnit === "fraction" && output.unit === "%") return value * 100;
  if (id === "surface_geopotential_height") return value / 9.80665;
  return value;
}

function publicLevel(level: NonIsobaricLevel): NonIsobaricFieldLevelResult {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m": return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function publicTemporal(
  semantics: "instantaneous" | "accumulation",
  run: Date,
  forecastHour: number,
): FieldTemporalResult {
  if (semantics === "instantaneous") return { type: "instantaneous" };
  return {
    type: "accumulation",
    startForecastHour: 0,
    endForecastHour: forecastHour,
    startTime: run.toISOString(),
    endTime: new Date(run.getTime() + forecastHour * HOUR_MS).toISOString(),
  };
}

function coriolisParameterS1(latitudeDeg: number): number {
  const earthAngularVelocityS1 = 7.292115e-5;
  return 2 * earthAngularVelocityS1 * Math.sin(latitudeDeg * Math.PI / 180);
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
      distribution: summarizeNumericDistribution(
        members.map((member) =>
          member.distribution.percentiles?.[index]?.value
          ?? missing(`spatial percentile ${percentile}`)),
        quantiles,
      ),
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
      distribution: summarizeNumericDistribution(
        members.map((member) =>
          member.distribution.thresholdFractions?.[index]?.fraction
          ?? missing(`spatial threshold ${threshold.operator} ${threshold.value}`)),
        quantiles,
      ),
      interpretation: "distribution_of_raw_member_spatial_fractions_not_calibrated_probability" as const,
    })),
  };
}

function memberExtrema(members: readonly MemberAreaComputation[]) {
  return members.map((member) => {
    if (!member.distribution.extrema) {
      throw new Error(`IFS ENS area member ${member.member} is missing requested extrema`);
    }
    return { member: member.member, ...member.distribution.extrema };
  });
}

function publicMembers(members: readonly MemberAreaComputation[]) {
  return members.map((member) => ({
    member: member.member,
    cacheHit: member.cacheHit,
    statistics: member.statistics,
    ...(member.distribution.percentiles === undefined
      ? {}
      : { percentiles: member.distribution.percentiles }),
    ...(member.distribution.thresholdFractions === undefined
      ? {}
      : { thresholdFractions: member.distribution.thresholdFractions }),
    ...(member.distribution.extrema === undefined
      ? {}
      : { extrema: member.distribution.extrema }),
  }));
}

function missing(context: string): never {
  throw new Error(`Internal IFS ENS area aggregation is missing ${context}`);
}
