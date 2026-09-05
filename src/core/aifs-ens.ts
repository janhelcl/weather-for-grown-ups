import { homedir } from "node:os";
import { join } from "node:path";
import { AifsEnsOpenDataSubsetCache } from "../cache/aifs-ens-open-data-cache.js";
import {
  AIFS_ENS_MEMBERS,
  sortAifsEnsMembers,
  type AifsEnsMember,
} from "../catalog/aifs-ens.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type {
  NonIsobaricFieldResult,
  ProfileDiagnosticResult,
  ProfileLevel,
} from "./types.js";
import { AifsLatestRunResolver } from "./aifs-run.js";
import { AifsForecastService } from "./aifs.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import { InvalidRequestError } from "../failure.js";

const MODEL = "aifs_ens_0p25" as const;
const DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY = 4;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const MEMBER_SET = new Set<string>(AIFS_ENS_MEMBERS);

export interface AifsEnsMemberService {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;
}

export interface AifsEnsForecastServiceOptions {
  cacheDir?: string;
  concurrency?: number;
  memberServiceFactory?: (member: AifsEnsMember) => AifsEnsMemberService;
}

interface MemberResult {
  member: AifsEnsMember;
  result: any;
}

export class AifsEnsForecastService {
  private readonly concurrency: number;
  private readonly memberServiceFactory: (member: AifsEnsMember) => AifsEnsMemberService;

  constructor(options: AifsEnsForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.concurrency = options.concurrency ?? DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY;
    this.memberServiceFactory = options.memberServiceFactory ?? ((member) => {
      const source = new AifsEnsOpenDataSubsetCache(
        join(cacheDir, "aifs-ens-open-data", member),
        member,
      );
      return new AifsForecastService({
        source,
        latestRunProvider: new AifsLatestRunResolver({ probe: source, cacheDir }),
      });
    });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aifs-ens") {
      throw new Error("AIFS ENS service only accepts dataset=aifs-ens");
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

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aifs-ens") {
      throw new Error("AIFS ENS service only accepts dataset=aifs-ens");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "AIFS ENS parcel diagnostics are not exposed in the current capability slice",
      );
    }
    const members = requestedMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);
    const results = await this.diagnoseMembers(request, members);
    return "at" in request.time
      ? summarizeDiagnosticInstant(request, results, members, quantiles)
      : summarizeDiagnosticRange(request, results, members, quantiles);
  }

  private async queryMembers(
    request: QueryAtmosphereRequest,
    members: AifsEnsMember[],
  ): Promise<MemberResult[]> {
    const firstMember = members[0]!;
    const firstService = this.memberServiceFactory(firstMember);
    const firstResult = await firstService.query(asAifsQuery(request));
    const run = resultRun(firstResult, "AIFS ENS member query");
    const rest = await mapConcurrent(
      members.slice(1),
      this.concurrency,
      async (member) => ({
        member,
        result: await this.memberServiceFactory(member).query(
          asAifsQuery(request, run),
        ),
      }),
    );
    return [{ member: firstMember, result: firstResult }, ...rest];
  }

  private async diagnoseMembers(
    request: DiagnoseAtmosphereRequest,
    members: AifsEnsMember[],
  ): Promise<MemberResult[]> {
    const firstMember = members[0]!;
    const firstService = this.memberServiceFactory(firstMember);
    const firstResult = await firstService.diagnose(asAifsDiagnostic(request));
    const run = resultRun(firstResult, "AIFS ENS member diagnostic");
    const rest = await mapConcurrent(
      members.slice(1),
      this.concurrency,
      async (member) => ({
        member,
        result: await this.memberServiceFactory(member).diagnose(
          asAifsDiagnostic(request, run),
        ),
      }),
    );
    return [{ member: firstMember, result: firstResult }, ...rest];
  }
}

function asAifsQuery(
  request: QueryAtmosphereRequest,
  runOverride?: string,
): QueryAtmosphereRequest {
  return {
    ...request,
    dataset: "aifs",
    forecast: {
      ...(request.forecast ?? {}),
      run: runOverride ?? request.forecast?.run ?? "latest",
    },
    ensemble: undefined,
    source: undefined,
  } as QueryAtmosphereRequest;
}

function asAifsDiagnostic(
  request: DiagnoseAtmosphereRequest,
  runOverride?: string,
): DiagnoseAtmosphereRequest {
  return {
    ...request,
    dataset: "aifs",
    forecast: {
      ...(request.forecast ?? {}),
      run: runOverride ?? request.forecast?.run ?? "latest",
    },
    ensemble: undefined,
    source: undefined,
  } as DiagnoseAtmosphereRequest;
}

function requestedMembers(input: readonly string[] | undefined): AifsEnsMember[] {
  const raw = input ?? AIFS_ENS_MEMBERS;
  const unsupported = raw.filter((member) => !MEMBER_SET.has(member));
  if (unsupported.length > 0) {
    throw new Error(
      `AIFS ENS members are c00,p01..p50; unsupported: ${unsupported.join(", ")}`,
    );
  }
  if (raw.length < 2) throw new Error("AIFS ENS requires at least two selected members");
  return sortAifsEnsMembers(raw as AifsEnsMember[]);
}

function requestedQuantiles(input: readonly number[] | undefined): number[] {
  return [...(input ?? DEFAULT_QUANTILES)].sort((left, right) => left - right);
}

function summarizePointInstant(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: AifsEnsMember[],
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
    ...profileSummaries(members.map((entry) => entry.result), quantiles),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            cacheHit: result.source?.cacheHit ?? false,
            levels: result.levels,
            ...(result.fields === undefined ? {} : { fields: result.fields }),
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizePointRange(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: AifsEnsMember[],
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
    series: first.series.map((step: any, index: number) => {
      const memberSteps = members.map(({ member, result }) => ({
        member,
        result: result.series[index],
      }));
      return {
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        ...profileSummaries(memberSteps.map((entry) => entry.result), quantiles),
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

function summarizePointsInstant(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: AifsEnsMember[],
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
      assertGridPointsEqual(memberPoints.map((candidate: any) => candidate.gridPoint), "AIFS ENS points");
      return {
        requestedPoint: point.requestedPoint,
        gridPoint: point.gridPoint,
        ...profileSummaries(memberPoints, quantiles),
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
  selectedMembers: AifsEnsMember[],
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
      assertSamePointCount(
        members.map((entry, index) => ({ member: entry.member, result: memberSteps[index] })),
        (result) => result.points,
      );
      return {
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        points: step.points.map((point: any, pointIndex: number) => {
          const memberPoints = memberSteps.map((candidate: any) => candidate.points[pointIndex]);
          assertGridPointsEqual(
            memberPoints.map((candidate: any) => candidate.gridPoint),
            "AIFS ENS point time series",
          );
          return {
            requestedPoint: point.requestedPoint,
            gridPoint: point.gridPoint,
            ...profileSummaries(memberPoints, quantiles),
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
  selectedMembers: AifsEnsMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const sampleCount = first.samples.length;
  for (const entry of members) {
    if (entry.result.samples.length !== sampleCount) {
      throw new Error("AIFS ENS member transects returned inconsistent sample counts");
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
        "AIFS ENS transect",
      );
      return {
        index: sample.index,
        fraction: sample.fraction,
        distanceKm: sample.distanceKm,
        requestedPoint: sample.requestedPoint,
        gridPoint: sample.gridPoint,
        ...profileSummaries(memberSamples, quantiles),
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
  selectedMembers: AifsEnsMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const memberGridPoints = members.map(({ result }) => result.statistics.definedGridPoints);
  const estimatedMemberGridPoints = memberGridPoints.reduce((sum, count) => sum + count, 0);
  const maxMemberGridPoints = request.limits?.maxMemberGridPoints ?? 2_000_000;
  if (estimatedMemberGridPoints > maxMemberGridPoints) {
    throw new InvalidRequestError(
      `AIFS ENS area member × grid selection contains approximately ${estimatedMemberGridPoints} member-grid points, exceeding maxMemberGridPoints=${maxMemberGridPoints}`,
    );
  }

  const result: any = {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    bbox: first.bbox,
    selection: {
      ...(first.variable === undefined ? {} : { variable: first.variable }),
      ...(first.field === undefined ? {} : { field: first.field }),
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
            `AIFS ENS member spatial percentile ${percentile}`,
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
            `AIFS ENS member spatial threshold ${threshold.operator} ${threshold.value}`,
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
        `AIFS ENS member extrema for ${member}`,
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

function summarizeDiagnosticInstant(
  request: DiagnoseAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: AifsEnsMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  assertCommonPointGrid(members, (entry) => entry.result.gridPoint);

  if (request.diagnostic.kind === "layer") {
    const diagnostic = request.diagnostic;
    const aggregate = summarizeEnsembleLayerDiagnostics(
      diagnostic.diagnostics,
      members.map(({ member, result }) => ({
        member,
        layer: result.layer,
        diagnostics: result.diagnostics,
      })),
      quantiles,
    );
    return {
      model: MODEL,
      run: first.run,
      validTime: first.validTime,
      forecastHour: first.forecastHour,
      requestedPoint: first.requestedPoint,
      gridPoint: first.gridPoint,
      pressureLayer: {
        lowerPressureHpa: request.diagnostic.lowerPressureHpa,
        upperPressureHpa: request.diagnostic.upperPressureHpa,
      },
      selection: {
        diagnostics: diagnostic.diagnostics,
        members: selectedMembers,
        quantiles,
      },
      layerDepthGpm: aggregate.layerDepthGpm,
      summaries: aggregate.summaries,
      ...(request.ensemble?.includeMembers
        ? {
            members: members.map(({ member, result }) => ({
              member,
              cacheHit: result.source?.cacheHit ?? false,
              layer: result.layer,
              diagnostics: result.diagnostics,
            })),
          }
        : {}),
      source: ensembleSource(members),
    };
  }

  if (request.diagnostic.kind !== "profile") {
    throw new Error("Internal AIFS ENS diagnostic routing error: parcel diagnostics are unsupported");
  }
  const diagnostic = request.diagnostic;

  const profileMembers = members.map(({ member, result }) => ({
    member,
    diagnostics: result.diagnostics as ProfileDiagnosticResult[],
  }));
  return {
    model: MODEL,
    run: first.run,
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    sampledPressureLevelsHpa: first.sampledPressureLevelsHpa,
    selection: {
      diagnostics: diagnostic.diagnostics,
      members: selectedMembers,
      quantiles,
    },
    summaries: summarizeEnsembleProfileDiagnostics(
      diagnostic.diagnostics,
      profileMembers,
      quantiles,
    ),
    ...(request.ensemble?.includeMembers
      ? {
          members: members.map(({ member, result }) => ({
            member,
            cacheHit: result.source?.cacheHit ?? false,
            levels: result.levels,
            diagnostics: result.diagnostics,
          })),
        }
      : {}),
    source: ensembleSource(members),
  };
}

function summarizeDiagnosticRange(
  request: DiagnoseAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: AifsEnsMember[],
  quantiles: number[],
) {
  if (request.diagnostic.kind === "parcel") {
    throw new Error("Internal AIFS ENS diagnostic routing error: parcel diagnostics are unsupported");
  }
  const diagnostic = request.diagnostic;
  const first = members[0]!.result;
  assertSameSeriesLength(members);
  return {
    model: MODEL,
    run: first.run,
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    diagnostic: request.diagnostic,
    selection: {
      members: selectedMembers,
      quantiles,
    },
    series: first.series.map((step: any, index: number) => {
      const memberSteps = members.map(({ member, result }) => ({
        member,
        result: result.series[index],
      }));
      if (diagnostic.kind === "layer") {
        const aggregate = summarizeEnsembleLayerDiagnostics(
          diagnostic.diagnostics,
          memberSteps.map(({ member, result }) => ({
            member,
            layer: result.layer,
            diagnostics: result.diagnostics,
          })),
          quantiles,
        );
        return {
          kind: "layer",
          validTime: step.validTime,
          forecastHour: step.forecastHour,
          layerDepthGpm: aggregate.layerDepthGpm,
          summaries: aggregate.summaries,
        };
      }
      return {
        kind: "profile",
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        summaries: summarizeEnsembleProfileDiagnostics(
          diagnostic.diagnostics,
          memberSteps.map(({ member, result }) => ({
            member,
            diagnostics: result.diagnostics,
          })),
          quantiles,
        ),
      };
    }),
    source: ensembleSource(members),
  };
}

function profileSummaries(results: readonly any[], quantiles: readonly number[]) {
  const first = results[0];
  const levels = (first?.levels ?? []) as ProfileLevel[];
  for (const result of results) {
    if ((result.levels?.length ?? 0) !== levels.length) {
      throw new Error("AIFS ENS member profiles returned inconsistent pressure-level counts");
    }
  }

  const pressureSummaries = levels.flatMap((level, levelIndex) => {
    const fields = numericProfileKeys(level);
    return fields.map((field) => {
      const values = results.map((result) =>
        requiredNumber(
          result.levels[levelIndex]?.[field],
          `AIFS ENS profile ${field}@${level.pressureHpa}mb`,
        ));
      return field === "windDirectionDeg"
        ? {
            pressureLevelHpa: level.pressureHpa,
            field,
            aggregation: "circular_direction" as const,
            ...summarizeCircularDegrees(values),
          }
        : {
            pressureLevelHpa: level.pressureHpa,
            field,
            aggregation: "numeric_distribution" as const,
            distribution: summarizeNumericDistribution(values, quantiles),
          };
    });
  });

  const fieldSummaries = aggregateFields(
    results.map((result) => result.fields ?? []),
    quantiles,
  );
  return {
    pressureSummaries,
    ...(fieldSummaries.length === 0 ? {} : { fieldSummaries }),
  };
}

function aggregateFields(
  members: readonly NonIsobaricFieldResult[][],
  quantiles: readonly number[],
) {
  const first = members[0] ?? [];
  for (const fields of members) {
    if (fields.length !== first.length) {
      throw new Error("AIFS ENS member field bundles returned inconsistent field counts");
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
        throw new Error(`AIFS ENS member field metadata disagree for ${field.id}`);
      }
    }
    const outputs = Object.keys(field.values).map((output) => {
      const values = candidates.map((candidate) =>
        requiredNumber(candidate.values[output], `AIFS ENS ${field.id}.${output}`));
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

function numericProfileKeys(level: ProfileLevel): Array<Exclude<keyof ProfileLevel, "pressureHpa">> {
  return Object.keys(level)
    .filter((key) => key !== "pressureHpa" && typeof (level as any)[key] === "number") as Array<
      Exclude<keyof ProfileLevel, "pressureHpa">
    >;
}

function ensembleSelection(
  request: QueryAtmosphereRequest,
  members: AifsEnsMember[],
  quantiles: number[],
) {
  return {
    variables: request.selection.variables ?? [],
    pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
    fields: request.selection.fields ?? [],
    members,
    quantiles,
  };
}

function ensembleSource(members: readonly MemberResult[]) {
  return {
    provider: "ECMWF Open Data" as const,
    product: "aifs_ens_0p25_enfo_cf_pf" as const,
    access: "indexed_http_range" as const,
    decoder: members[0]?.result?.source?.decoder ?? "gribberish",
    horizontalGridDegrees: 0.25,
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
  if (!Number.isInteger(length)) throw new Error("AIFS ENS member result is missing series");
  for (const { result } of members) {
    if (result.series?.length !== length) {
      throw new Error("AIFS ENS members returned inconsistent time-series lengths");
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
      throw new Error("AIFS ENS members returned inconsistent point counts");
    }
  }
}

function assertCommonPointGrid(
  members: readonly MemberResult[],
  select: (entry: MemberResult) => any,
): void {
  assertGridPointsEqual(members.map(select), "AIFS ENS members");
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
    throw new Error(`Internal AIFS ENS aggregation is missing ${context}`);
  }
  return value;
}

function requiredObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Internal AIFS ENS aggregation is missing ${context}`);
  }
  return value as Record<string, unknown>;
}
