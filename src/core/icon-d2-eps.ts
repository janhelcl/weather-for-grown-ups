import { homedir } from "node:os";
import { join } from "node:path";
import {
  IconD2EpsMemberFileFilter,
  IconD2EpsMemberSubsetCache,
  IconD2EpsOpenDataCache,
} from "../cache/icon-d2-eps-open-data-cache.js";
import {
  ICON_D2_EPS_MEMBERS,
  sortIconD2EpsMembers,
  type IconD2EpsMember,
} from "../catalog/icon-d2-eps.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type {
  NonIsobaricFieldResult,
  ProfileDiagnosticResult,
  ProfileLevel,
} from "./types.js";
import { IconD2RunResolver } from "./icon-d2-run.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import { Wgrib2GridDecoder } from "../grib/wgrib2-grid.js";
import { Wgrib2StatsDecoder } from "../grib/wgrib2-stats.js";
import { IconD2ForecastService } from "./icon-d2.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";

const MODEL = "icon_d2_eps_2p1km" as const;
const DEFAULT_ICON_D2_EPS_MEMBER_CONCURRENCY = 4;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const MEMBER_SET = new Set<string>(ICON_D2_EPS_MEMBERS);

export interface IconD2EpsMemberService {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;
}

export interface IconD2EpsForecastServiceOptions {
  cacheDir?: string;
  concurrency?: number;
  memberServiceFactory?: (member: IconD2EpsMember) => IconD2EpsMemberService;
}

interface MemberResult {
  member: IconD2EpsMember;
  result: any;
}

export class IconD2EpsForecastService {
  private readonly concurrency: number;
  private readonly memberServiceFactory: (member: IconD2EpsMember) => IconD2EpsMemberService;

  constructor(options: IconD2EpsForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.concurrency = options.concurrency ?? DEFAULT_ICON_D2_EPS_MEMBER_CONCURRENCY;
    const cache = new IconD2EpsOpenDataCache(
      join(cacheDir, "icon-d2-eps-open-data"),
    );
    const runProvider = new IconD2RunResolver(cache);
    const wgrib2 = process.env.WGRIB2_PATH ?? "wgrib2";
    const memberFilter = new IconD2EpsMemberFileFilter(
      join(cacheDir, "icon-d2-eps-members"),
      wgrib2,
    );
    this.memberServiceFactory = options.memberServiceFactory ?? ((member) => {
      const memberCache = new IconD2EpsMemberSubsetCache(cache, member, memberFilter);
      return new IconD2ForecastService({
        cache: memberCache,
        runProvider,
        decoder: new Wgrib2Decoder(wgrib2),
        areaDecoder: new Wgrib2StatsDecoder(wgrib2),
        areaGridDecoder: new Wgrib2GridDecoder(wgrib2),
      });
    });
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "icon-d2-eps") {
      throw new Error("ICON-D2-EPS service only accepts dataset=icon-d2-eps");
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
    if (request.dataset !== "icon-d2-eps") {
      throw new Error("ICON-D2-EPS service only accepts dataset=icon-d2-eps");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "ICON-D2-EPS parcel diagnostics are not exposed in the current capability slice",
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
    members: IconD2EpsMember[],
  ): Promise<MemberResult[]> {
    const firstMember = members[0]!;
    const firstService = this.memberServiceFactory(firstMember);
    const firstResult = await firstService.query(asIconD2Query(request));
    const run = resultRun(firstResult, "ICON-D2-EPS member query");
    const rest = await mapConcurrent(
      members.slice(1),
      this.concurrency,
      async (member) => ({
        member,
        result: await this.memberServiceFactory(member).query(
          asIconD2Query(request, run),
        ),
      }),
    );
    return [{ member: firstMember, result: firstResult }, ...rest];
  }

  private async diagnoseMembers(
    request: DiagnoseAtmosphereRequest,
    members: IconD2EpsMember[],
  ): Promise<MemberResult[]> {
    const firstMember = members[0]!;
    const firstService = this.memberServiceFactory(firstMember);
    const firstResult = await firstService.diagnose(asIconD2Diagnostic(request));
    const run = resultRun(firstResult, "ICON-D2-EPS member diagnostic");
    const rest = await mapConcurrent(
      members.slice(1),
      this.concurrency,
      async (member) => ({
        member,
        result: await this.memberServiceFactory(member).diagnose(
          asIconD2Diagnostic(request, run),
        ),
      }),
    );
    return [{ member: firstMember, result: firstResult }, ...rest];
  }
}

function asIconD2Query(
  request: QueryAtmosphereRequest,
  runOverride?: string,
): QueryAtmosphereRequest {
  return {
    ...request,
    dataset: "icon-d2",
    forecast: {
      ...(request.forecast ?? {}),
      run: runOverride ?? request.forecast?.run ?? "latest",
    },
    ensemble: undefined,
    source: undefined,
  } as QueryAtmosphereRequest;
}

function asIconD2Diagnostic(
  request: DiagnoseAtmosphereRequest,
  runOverride?: string,
): DiagnoseAtmosphereRequest {
  return {
    ...request,
    dataset: "icon-d2",
    forecast: {
      ...(request.forecast ?? {}),
      run: runOverride ?? request.forecast?.run ?? "latest",
    },
    ensemble: undefined,
    source: undefined,
  } as DiagnoseAtmosphereRequest;
}

function requestedMembers(input: readonly string[] | undefined): IconD2EpsMember[] {
  const raw = input ?? ICON_D2_EPS_MEMBERS;
  const unsupported = raw.filter((member) => !MEMBER_SET.has(member));
  if (unsupported.length > 0) {
    throw new Error(
      `ICON-D2-EPS members are p01..p20; unsupported: ${unsupported.join(", ")}`,
    );
  }
  if (raw.length < 2) throw new Error("ICON-D2-EPS requires at least two selected members");
  return sortIconD2EpsMembers(raw as IconD2EpsMember[]);
}

function requestedQuantiles(input: readonly number[] | undefined): number[] {
  return [...(input ?? DEFAULT_QUANTILES)].sort((left, right) => left - right);
}

function summarizePointInstant(
  request: QueryAtmosphereRequest,
  members: MemberResult[],
  selectedMembers: IconD2EpsMember[],
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
  selectedMembers: IconD2EpsMember[],
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
  selectedMembers: IconD2EpsMember[],
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
      assertGridPointsEqual(memberPoints.map((candidate: any) => candidate.gridPoint), "ICON-D2-EPS points");
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
  selectedMembers: IconD2EpsMember[],
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
            "ICON-D2-EPS point time series",
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
  selectedMembers: IconD2EpsMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const sampleCount = first.samples.length;
  for (const entry of members) {
    if (entry.result.samples.length !== sampleCount) {
      throw new Error("ICON-D2-EPS member transects returned inconsistent sample counts");
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
        "ICON-D2-EPS transect",
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
  selectedMembers: IconD2EpsMember[],
  quantiles: number[],
) {
  const first = members[0]!.result;
  const memberGridPoints = members.map(({ result }) => result.statistics.definedGridPoints);
  const estimatedMemberGridPoints = memberGridPoints.reduce((sum, count) => sum + count, 0);
  const maxMemberGridPoints = request.limits?.maxMemberGridPoints ?? 2_000_000;
  if (estimatedMemberGridPoints > maxMemberGridPoints) {
    throw new Error(
      `ICON-D2-EPS area member × grid selection contains approximately ${estimatedMemberGridPoints} member-grid points, exceeding maxMemberGridPoints=${maxMemberGridPoints}`,
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
            `ICON-D2-EPS member spatial percentile ${percentile}`,
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
            `ICON-D2-EPS member spatial threshold ${threshold.operator} ${threshold.value}`,
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
        `ICON-D2-EPS member extrema for ${member}`,
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
  selectedMembers: IconD2EpsMember[],
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
    throw new Error("Internal ICON-D2-EPS diagnostic routing error: parcel diagnostics are unsupported");
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
  selectedMembers: IconD2EpsMember[],
  quantiles: number[],
) {
  if (request.diagnostic.kind === "parcel") {
    throw new Error("Internal ICON-D2-EPS diagnostic routing error: parcel diagnostics are unsupported");
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
      throw new Error("ICON-D2-EPS member profiles returned inconsistent pressure-level counts");
    }
  }

  const pressureSummaries = levels.flatMap((level, levelIndex) => {
    const fields = numericProfileKeys(level);
    return fields.map((field) => {
      const values = results.map((result) =>
        requiredNumber(
          result.levels[levelIndex]?.[field],
          `ICON-D2-EPS profile ${field}@${level.pressureHpa}mb`,
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
      throw new Error("ICON-D2-EPS member field bundles returned inconsistent field counts");
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
        throw new Error(`ICON-D2-EPS member field metadata disagree for ${field.id}`);
      }
    }
    const outputs = Object.keys(field.values).map((output) => {
      const values = candidates.map((candidate) =>
        requiredNumber(candidate.values[output], `ICON-D2-EPS ${field.id}.${output}`));
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
  members: IconD2EpsMember[],
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
    provider: "DWD Open Data" as const,
    product: "icon_d2_eps_native_icosahedral" as const,
    access: "dwd_open_data" as const,
    decoder: "wgrib2" as const,
    nativeGrid: {
      type: "icosahedral" as const,
      nominalResolutionKm: 2.1,
    },
    packaging: "all_members_grib2_bz2" as const,
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
  if (!Number.isInteger(length)) throw new Error("ICON-D2-EPS member result is missing series");
  for (const { result } of members) {
    if (result.series?.length !== length) {
      throw new Error("ICON-D2-EPS members returned inconsistent time-series lengths");
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
      throw new Error("ICON-D2-EPS members returned inconsistent point counts");
    }
  }
}

function assertCommonPointGrid(
  members: readonly MemberResult[],
  select: (entry: MemberResult) => any,
): void {
  assertGridPointsEqual(members.map(select), "ICON-D2-EPS members");
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
    throw new Error(`Internal ICON-D2-EPS aggregation is missing ${context}`);
  }
  return value;
}

function requiredObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Internal ICON-D2-EPS aggregation is missing ${context}`);
  }
  return value as Record<string, unknown>;
}
