import { homedir } from "node:os";
import { join } from "node:path";
import { PeAromeWcsCache } from "../cache/pe-arome-wcs-cache.js";
import {
  PE_AROME_MEMBERS,
  sortPeAromeMembers,
  type PeAromeMember,
} from "../catalog/pe-arome.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import { Wgrib2GridDecoder } from "../grib/wgrib2-grid.js";
import { Wgrib2StatsDecoder } from "../grib/wgrib2-stats.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import { parsePeAromeRun } from "../sources/pe-arome.js";
import { AromeForecastService } from "./arome.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import { PeAromeRunResolver } from "./pe-arome-run.js";
import type { NonIsobaricFieldResult } from "./types.js";
import { InvalidRequestError } from "../failure.js";

const MODEL = "pe_arome_0p025" as const;
const DEFAULT_PE_AROME_MEMBER_CONCURRENCY = 2;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const MEMBER_SET = new Set<string>(PE_AROME_MEMBERS);
const AROME_TO_PE_AROME_GRID_RATIO = 2.5;
const GRID_POINT_SCALE = AROME_TO_PE_AROME_GRID_RATIO * AROME_TO_PE_AROME_GRID_RATIO;

export interface PeAromeMemberService {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
}

export interface PeAromeForecastServiceOptions {
  cacheDir?: string;
  concurrency?: number;
  memberServiceFactory?: (member: PeAromeMember) => PeAromeMemberService;
}

interface MemberResult {
  member: PeAromeMember;
  result: any;
}

export class PeAromeForecastService {
  private readonly concurrency: number;
  private readonly memberServiceFactory: (member: PeAromeMember) => PeAromeMemberService;

  constructor(options: PeAromeForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.concurrency = options.concurrency ?? DEFAULT_PE_AROME_MEMBER_CONCURRENCY;
     this.memberServiceFactory = options.memberServiceFactory ?? ((member) => {
      const cache = new PeAromeWcsCache(
        join(cacheDir, "pe-arome-wcs", member),
        member,
      );
      return new AromeForecastService({
        cache,
        runProvider: new PeAromeRunResolver(cache),
        decoder: new Wgrib2Decoder(),
        areaDecoder: new Wgrib2StatsDecoder(),
        areaGridDecoder: new Wgrib2GridDecoder(),
      });
    });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "pe-arome") {
      throw new Error("PE-AROME service only accepts dataset=pe-arome");
    }
    const explicitRun = request.forecast?.run;
    if (
      explicitRun !== undefined
      && explicitRun !== "latest"
      && explicitRun !== "latest_complete"
    ) {
      parsePeAromeRun(explicitRun);
    }

    const members = requestedMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);
    const results = await this.queryMembers(request, members);

    if (request.geometry.type === "point") {
      return "at" in request.time
        ? summarizePointInstant(request, results, members, quantiles)
        : summarizePointRange(request, results, members, quantiles);
    }
    if (request.geometry.type === "points") {
      return "at" in request.time
        ? summarizePointsInstant(request, results, members, quantiles)
        : summarizePointsRange(request, results, members, quantiles);
    }
    if (request.geometry.type === "transect") {
      return summarizeTransect(request, results, members, quantiles);
    }
    return summarizeArea(request, results, members, quantiles);
  }

  private async queryMembers(
    request: QueryAtmosphereRequest,
    members: PeAromeMember[],
  ): Promise<MemberResult[]> {
    const firstMember = members[0]!;
    const firstService = this.memberServiceFactory(firstMember);
    const firstResult = await firstService.query(asAromeQuery(request));
    const run = resultRun(firstResult, "PE-AROME member query");
    const rest = await mapConcurrent(
      members.slice(1),
      this.concurrency,
      async (member) => ({
        member,
        result: await this.memberServiceFactory(member).query(
          asAromeQuery(request, run),
        ),
      }),
    );
    return [{ member: firstMember, result: firstResult }, ...rest];
  }
}

function asAromeQuery(
  request: QueryAtmosphereRequest,
  runOverride?: string,
): QueryAtmosphereRequest {
  const limits = request.geometry.type === "area"
    ? {
        ...(request.limits ?? {}),
        maxGridPoints: Math.ceil(
          (request.limits?.maxGridPoints ?? 1_100_000) * GRID_POINT_SCALE,
        ),
      }
    : request.limits;

  return {
    ...request,
    dataset: "arome",
    forecast: {
      ...(request.forecast ?? {}),
      run: runOverride ?? request.forecast?.run ?? "latest",
    },
    ensemble: undefined,
    source: undefined,
    ...(limits === undefined ? {} : { limits }),
  } as QueryAtmosphereRequest;
}

function requestedMembers(input: readonly string[] | undefined): PeAromeMember[] {
  const raw = input ?? PE_AROME_MEMBERS;
  const unsupported = raw.filter((member) => !MEMBER_SET.has(member));
  if (unsupported.length > 0) {
    throw new Error(
      `PE-AROME members are c00,p01..p24; unsupported: ${unsupported.join(", ")}`,
    );
  }
  if (raw.length < 2) throw new Error("PE-AROME requires at least two selected members");
  return sortPeAromeMembers(raw as PeAromeMember[]);
}

function requestedQuantiles(input: readonly number[] | undefined): number[] {
  return [...(input ?? DEFAULT_QUANTILES)].sort((left, right) => left - right);
}

function summarizePointInstant(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  assertCommonPointGrid(members, (entry) => entry.result.gridPoint);
  return {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    selection: ensembleSelection(request, selectedMembers, quantiles),
    fieldSummaries: aggregateFields(
      members.map(({ result }) => result.fields ?? []),
      quantiles,
    ),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            cacheHit: result.source?.cacheHit ?? false,
            fields: result.fields ?? [],
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizePointRange(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  assertSameSeriesLength(members);
  assertCommonPointGrid(members, (entry) => entry.result.gridPoint);
  return {
    model: MODEL,
    run: first.run,
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    selection: ensembleSelection(request, selectedMembers, quantiles),
    series: first.series.map((step: any, index: number) => ({
      validTime: step.validTime,
      forecastHour: step.forecastHour,
      fieldSummaries: aggregateFields(
        members.map(({ result }) => result.series[index]?.fields ?? []),
        quantiles,
      ),
    })),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            series: result.series,
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizePointsInstant(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  assertSamePointCount(members, (result) => result.points);
  return {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    selection: ensembleSelection(request, selectedMembers, quantiles),
    points: first.points.map((point: any, index: number) => {
      const memberPoints = members.map(({ result }) => result.points[index]);
      assertGridPointsEqual(
        memberPoints.map((candidate: any) => candidate.gridPoint),
        "PE-AROME points",
      );
      return {
        requestedPoint: point.requestedPoint,
        gridPoint: point.gridPoint,
        fieldSummaries: aggregateFields(
          memberPoints.map((candidate: any) => candidate.fields ?? []),
          quantiles,
        ),
      };
    }),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            cacheHit: result.source?.cacheHit ?? false,
            points: result.points,
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizePointsRange(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  assertSameSeriesLength(members);
  return {
    model: MODEL,
    run: first.run,
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    selection: ensembleSelection(request, selectedMembers, quantiles),
    series: first.series.map((step: any, stepIndex: number) => {
      const memberSteps = members.map(({ result }) => result.series[stepIndex]);
      const pointCount = step.points.length;
      for (const memberStep of memberSteps) {
        if (memberStep?.points?.length !== pointCount) {
          throw new Error("PE-AROME members returned inconsistent point counts");
        }
      }
      return {
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        points: step.points.map((point: any, pointIndex: number) => {
          const memberPoints = memberSteps.map((candidate: any) => candidate.points[pointIndex]);
          assertGridPointsEqual(
            memberPoints.map((candidate: any) => candidate.gridPoint),
            "PE-AROME point time series",
          );
          return {
            requestedPoint: point.requestedPoint,
            gridPoint: point.gridPoint,
            fieldSummaries: aggregateFields(
              memberPoints.map((candidate: any) => candidate.fields ?? []),
              quantiles,
            ),
          };
        }),
      };
    }),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            series: result.series,
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizeTransect(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const sampleCount = first.samples.length;
  for (const entry of members) {
    if (entry.result.samples.length !== sampleCount) {
      throw new Error("PE-AROME member transects returned inconsistent sample counts");
    }
  }
  return {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    startPoint: first.startPoint,
    endPoint: first.endPoint,
    totalDistanceKm: first.totalDistanceKm,
    selection: ensembleSelection(request, selectedMembers, quantiles),
    samples: first.samples.map((sample: any, index: number) => {
      const memberSamples = members.map(({ result }) => result.samples[index]);
      assertGridPointsEqual(
        memberSamples.map((candidate: any) => candidate.gridPoint),
        "PE-AROME transect",
      );
      return {
        index: sample.index,
        fraction: sample.fraction,
        distanceKm: sample.distanceKm,
        requestedPoint: sample.requestedPoint,
        gridPoint: sample.gridPoint,
        fieldSummaries: aggregateFields(
          memberSamples.map((candidate: any) => candidate.fields ?? []),
          quantiles,
        ),
      };
    }),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            samples: result.samples,
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizeArea(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: PeAromeMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const memberGridPoints = members.map(({ result }) => result.statistics.definedGridPoints);
  const estimatedMemberGridPoints = memberGridPoints.reduce((sum, count) => sum + count, 0);
  const maxMemberGridPoints = request.limits?.maxMemberGridPoints ?? 2_000_000;
  if (estimatedMemberGridPoints > maxMemberGridPoints) {
    throw new InvalidRequestError(
      `PE-AROME area member × grid selection contains approximately ${estimatedMemberGridPoints} member-grid points, exceeding maxMemberGridPoints=${maxMemberGridPoints}`,
    );
  }

  const result: any = {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    bbox: first.bbox,
    selection: {
      field: first.field,
      members: selectedMembers,
      quantiles,
    },
    methodology: "spatial_statistics_per_member_then_ensemble_distribution",
    statistics: {
      definedGridPoints: summarizeNumericDistribution(memberGridPoints, quantiles),
      mean: summarizeNumericDistribution(
        members.map(({ result }) => result.statistics.mean),
        quantiles,
      ),
      min: summarizeNumericDistribution(
        members.map(({ result }) => result.statistics.min),
        quantiles,
      ),
      max: summarizeNumericDistribution(
        members.map(({ result }) => result.statistics.max),
        quantiles,
      ),
    },
    source: ensembleSource(members),
  };

  const requestedPercentiles = request.aggregate?.percentiles ?? [];
  if (requestedPercentiles.length > 0) {
    result.spatialPercentiles = requestedPercentiles.map((percentile, index) => ({
      percentile,
      percentileMethod: "linear_interpolation_sorted_defined_grid_points",
      distribution: summarizeNumericDistribution(
        members.map(({ result: memberResult }) =>
          requiredNumber(
            memberResult.distribution?.percentiles?.[index]?.value,
            `PE-AROME member spatial percentile ${percentile}`,
          )),
        quantiles,
      ),
    }));
  }

  const requestedThresholds = request.aggregate?.thresholds ?? [];
  if (requestedThresholds.length > 0) {
    result.spatialThresholdFractions = requestedThresholds.map((threshold, index) => ({
      operator: threshold.operator,
      threshold: threshold.value,
      distribution: summarizeNumericDistribution(
        members.map(({ result: memberResult }) =>
          requiredNumber(
            memberResult.distribution?.thresholdFractions?.[index]?.fraction,
            `PE-AROME member spatial threshold ${threshold.operator} ${threshold.value}`,
          )),
        quantiles,
      ),
      interpretation:
        "distribution_of_raw_member_spatial_fractions_not_calibrated_probability",
    }));
  }

  if (request.aggregate?.includeExtremaLocations === true) {
    result.memberExtrema = members.map(({ member, result: memberResult }) => ({
      member,
      ...requiredObject(
        memberResult.distribution?.extrema,
        `PE-AROME member extrema for ${member}`,
      ),
    }));
  }

  if (request.ensemble?.includeMembers === true) {
    result.members = members.map(({ member, result: memberResult }) => ({
      member,
      cacheHit: memberResult.source?.cacheHit ?? false,
      statistics: memberResult.statistics,
      ...(memberResult.distribution === undefined
        ? {}
        : { distribution: memberResult.distribution }),
    }));
  }
  return result;
}

function aggregateFields(
  members: readonly NonIsobaricFieldResult[][],
  quantiles: readonly number[],
) {
  const first = members[0] ?? [];
  for (const fields of members) {
    if (fields.length !== first.length) {
      throw new Error("PE-AROME member field bundles returned inconsistent field counts");
    }
  }
  return first.map((field, fieldIndex) => {
    const candidates = members.map((fields) => fields[fieldIndex]!);
    for (const candidate of candidates) {
      if (
        candidate.id !== field.id
        || JSON.stringify(candidate.level) !== JSON.stringify(field.level)
        || JSON.stringify(candidate.temporal) !== JSON.stringify(field.temporal)
      ) {
        throw new Error(`PE-AROME member field metadata disagree for ${field.id}`);
      }
    }
    const outputs = Object.keys(field.values).map((output) => {
      const values = candidates.map((candidate) =>
        requiredNumber(candidate.values[output], `PE-AROME ${field.id}.${output}`));
      return output === "windDirectionDeg"
        ? {
            field: output,
            aggregation: "circular_direction" as const,
            ...summarizeCircularDegrees(values),
          }
        : {
            field: output,
            aggregation: "numeric_distribution" as const,
            distribution: summarizeNumericDistribution(values, quantiles),
          };
    });
    return {
      field: field.id,
      level: field.level,
      temporal: field.temporal,
      outputs,
    };
  });
}

function ensembleSelection(
  request: QueryAtmosphereRequest,
  members: PeAromeMember[],
  quantiles: number[],
) {
  return {
    fields: request.selection.fields ?? [],
    members,
    quantiles,
  };
}

function ensembleSource(members: readonly MemberResult[]) {
  return {
    provider: "Météo-France Public API" as const,
    product: "PEAROME metropolitan 0.025 degree" as const,
    access: "meteo_france_wcs" as const,
    decoder: "wgrib2" as const,
    nativeGrid: {
      type: "lambert_conformal" as const,
    },
    samplingGrid: {
      type: "regular_latlon" as const,
      resolutionDegrees: 0.025 as const,
      interpolation: "meteo_france_wcs" as const,
    },
    packaging: "one_member_one_field_wcs_grib2" as const,
    memberCount: members.length,
    allCacheHit: members.every(({ result }) => resultCacheHit(result)),
  };
}

function resultCacheHit(result: any): boolean {
  if (typeof result?.source?.cacheHit === "boolean") return result.source.cacheHit;
  if (Array.isArray(result?.series)) {
    return result.series.every((step: any) => step.cacheHit === true);
  }
  return false;
}

function resultRun(result: unknown, context: string): string {
  if (
    typeof result !== "object"
    || result === null
    || !("run" in result)
    || typeof (result as any).run !== "string"
  ) {
    throw new Error(`${context} did not return a resolved run`);
  }
  return (result as any).run;
}

function assertSameSeriesLength(members: readonly MemberResult[]): void {
  const length = members[0]?.result?.series?.length;
  if (!Number.isInteger(length)) throw new Error("PE-AROME member result is missing series");
  for (const { result } of members) {
    if (result.series?.length !== length) {
      throw new Error("PE-AROME members returned inconsistent time-series lengths");
    }
  }
}

function assertSamePointCount(
  members: readonly MemberResult[],
  select: (result: any) => readonly unknown[],
): void {
  const count = select(members[0]?.result).length;
  for (const { result } of members) {
    if (select(result).length !== count) {
      throw new Error("PE-AROME members returned inconsistent point counts");
    }
  }
}

function assertCommonPointGrid(
  members: readonly MemberResult[],
  select: (entry: MemberResult) => any,
): void {
  assertGridPointsEqual(members.map(select), "PE-AROME members");
}

function assertGridPointsEqual(points: readonly any[], context: string): void {
  const first = points[0];
  if (first === undefined) throw new Error(`${context} returned no grid point`);
  for (const point of points) {
    if (
      point?.latitude !== first.latitude
      || point?.longitude !== first.longitude
    ) {
      throw new Error(`${context} resolved to inconsistent grid points`);
    }
  }
}

function requiredNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Internal PE-AROME aggregation is missing ${context}`);
  }
  return value;
}

function requiredObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Internal PE-AROME aggregation is missing ${context}`);
  }
  return value as Record<string, unknown>;
}
