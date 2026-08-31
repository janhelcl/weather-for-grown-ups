import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
} from "../access/access-policy.js";
import { AigfsNomadsSubsetCache } from "../cache/aigfs-nomads-subset-cache.js";
import {
  AIGEFS_MEMBERS,
  type AigefsMember,
} from "../catalog/aigfs.js";
import { NON_ISOBARIC_FIELD_CATALOG } from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import {
  aigefsMemberNomadsPaths,
  aigefsStatisticNomadsPaths,
  aigfsNativeForecastHoursInRange,
} from "../sources/aigfs.js";
import {
  AigfsRunResolver,
  resolveAigfsRun,
  type AigfsRunProvider,
  type AigfsRunRequirement,
} from "./aigfs-run.js";
import { AigfsForecastService } from "./aigfs.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";

const MODEL = "aigefs_0p25" as const;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const DEFAULT_MAX_MEMBER_SAMPLES = 5_000;
const DEFAULT_AREA_MAX_GRID_POINTS = 50_000;
const DEFAULT_AREA_MAX_MEMBER_GRID_POINTS = 250_000;

type MemberService = Pick<AigfsForecastService, "query" | "diagnose">;

export interface AigefsForecastServiceOptions {
  cacheDir?: string;
  runProvider?: AigfsRunProvider;
  memberServiceFactory?: (member: AigefsMember) => MemberService;
}

interface MemberResult {
  member: AigefsMember;
  result: any;
}

interface StateSample {
  member: AigefsMember;
  gridPoint: { latitude: number; longitude: number };
  levels: any[];
  fields?: any[];
  cacheHit: boolean;
}

export class AigefsForecastService {
  private readonly runProvider: AigfsRunProvider;
  private readonly memberServiceFactory: (member: AigefsMember) => MemberService;
  private readonly services = new Map<AigefsMember, MemberService>();

  constructor(options: AigefsForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    const sharedAccessPolicy = new FileAccessPolicy(
      join(cacheDir, "aigfs", "access-state"),
      UPSTREAM_ACCESS_POLICIES.nomads,
    );
    const completenessProbe = new AigfsNomadsSubsetCache(
      join(cacheDir, "aigfs", "ensemble-stats"),
      globalThis.fetch,
      sharedAccessPolicy,
      aigefsStatisticNomadsPaths("avg"),
    );
    this.runProvider = options.runProvider ?? new AigfsRunResolver(completenessProbe);

    const decoder = new Wgrib2Decoder();
    this.memberServiceFactory = options.memberServiceFactory ?? ((member) =>
      new AigfsForecastService({
        cache: new AigfsNomadsSubsetCache(
          join(cacheDir, "aigfs", "ensemble", member),
          globalThis.fetch,
          sharedAccessPolicy,
          aigefsMemberNomadsPaths(member),
        ),
        decoder,
        runProvider: this.runProvider,
      }));
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aigefs") {
      throw new Error("AIGEFS service only accepts dataset=aigefs");
    }
    const members = selectedMembers(request);
    const quantiles = selectedQuantiles(request);
    const run = await this.resolveRun(request.forecast?.run ?? "latest", queryRequirement(request));
    enforceQueryMemberLimits(request, run, members.length);
    const memberRequest = {
      ...request,
      dataset: "aigfs",
      forecast: { ...request.forecast, run: run.toISOString() },
      ensemble: undefined,
    } as QueryAtmosphereRequest;

    const samples = await Promise.all(members.map(async (member) => ({
      member,
      result: await this.memberService(member).query(memberRequest),
    })));

    if (request.geometry.type === "point") {
      return "at" in request.time
        ? aggregatePoint(request, run, samples, members, quantiles)
        : aggregatePointRange(request, run, samples, members, quantiles);
    }
    if (request.geometry.type === "points") {
      return "at" in request.time
        ? aggregatePoints(request, run, samples, members, quantiles)
        : aggregatePointsRange(request, run, samples, members, quantiles);
    }
    if (request.geometry.type === "transect") {
      return aggregateTransect(request, run, samples, members, quantiles);
    }
    return aggregateArea(request, run, samples, members, quantiles);
  }

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "aigefs") {
      throw new Error("AIGEFS service only accepts dataset=aigefs");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "AIGEFS does not expose parcel diagnostics because its surface product lacks the required parcel initialization state",
      );
    }
    const members = selectedMembers(request);
    const quantiles = selectedQuantiles(request);
    const run = await this.resolveRun(
      request.forecast?.run ?? "latest",
      diagnosticRequirement(request),
    );
    enforceDiagnosticMemberLimit(request, run, members.length);
    const memberRequest = {
      ...request,
      dataset: "aigfs",
      forecast: { ...request.forecast, run: run.toISOString() },
      ensemble: undefined,
    } as DiagnoseAtmosphereRequest;
    const samples = await Promise.all(members.map(async (member) => ({
      member,
      result: await this.memberService(member).diagnose(memberRequest),
    })));

    return "at" in request.time
      ? aggregateInstantDiagnostic(request, run, samples, members, quantiles)
      : aggregateDiagnosticRange(request, run, samples, members, quantiles);
  }

  private memberService(member: AigefsMember): MemberService {
    const existing = this.services.get(member);
    if (existing) return existing;
    const service = this.memberServiceFactory(member);
    this.services.set(member, service);
    return service;
  }

  private resolveRun(selector: string, requirement: AigfsRunRequirement): Promise<Date> {
    return Promise.resolve(resolveAigfsRun(selector, requirement, this.runProvider));
  }
}


function enforceQueryMemberLimits(
  request: QueryAtmosphereRequest,
  run: Date,
  memberCount: number,
): void {
  if (request.geometry.type === "area") {
    const longitudePoints =
      Math.ceil((request.geometry.eastLongitude - request.geometry.westLongitude) / 0.25) + 2;
    const latitudePoints =
      Math.ceil((request.geometry.northLatitude - request.geometry.southLatitude) / 0.25) + 2;
    const gridPoints = Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
    const maxGridPoints = request.limits?.maxGridPoints ?? DEFAULT_AREA_MAX_GRID_POINTS;
    if (gridPoints > maxGridPoints) {
      throw new Error(
        `Requested AIGEFS bbox is approximately ${gridPoints} grid points per member, exceeding maxGridPoints=${maxGridPoints}`,
      );
    }
    const memberGridPoints = gridPoints * memberCount;
    const maxMemberGridPoints =
      request.limits?.maxMemberGridPoints ?? DEFAULT_AREA_MAX_MEMBER_GRID_POINTS;
    if (memberGridPoints > maxMemberGridPoints) {
      throw new Error(
        `Requested AIGEFS bbox × member selection is approximately ${memberGridPoints} member-grid points, exceeding maxMemberGridPoints=${maxMemberGridPoints}`,
      );
    }
    return;
  }

  const maxMemberSamples =
    request.ensemble?.maxMemberSamples ?? DEFAULT_MAX_MEMBER_SAMPLES;
  const spatialSamples = request.geometry.type === "point"
    ? 1
    : request.geometry.type === "points"
      ? request.geometry.points.length
      : request.geometry.samples ?? 21;
  const timeSteps = "at" in request.time
    ? 1
    : aigfsNativeForecastHoursInRange(
        run,
        new Date(request.time.from),
        new Date(request.time.to),
      ).length;
  const memberSamples = spatialSamples * timeSteps * memberCount;
  if (memberSamples > maxMemberSamples) {
    throw new Error(
      `Requested AIGEFS query contains ${memberSamples} member samples, exceeding maxMemberSamples=${maxMemberSamples}`,
    );
  }
}

function enforceDiagnosticMemberLimit(
  request: DiagnoseAtmosphereRequest,
  run: Date,
  memberCount: number,
): void {
  const maxMemberSamples =
    request.ensemble?.maxMemberSamples ?? DEFAULT_MAX_MEMBER_SAMPLES;
  const timeSteps = "at" in request.time
    ? 1
    : aigfsNativeForecastHoursInRange(
        run,
        new Date(request.time.from),
        new Date(request.time.to),
      ).length;
  const memberSamples = timeSteps * memberCount;
  if (memberSamples > maxMemberSamples) {
    throw new Error(
      `Requested AIGEFS diagnostic contains ${memberSamples} member samples, exceeding maxMemberSamples=${maxMemberSamples}`,
    );
  }
}

function selectedMembers(
  request: QueryAtmosphereRequest | DiagnoseAtmosphereRequest,
): AigefsMember[] {
  return [...(request.ensemble?.members ?? AIGEFS_MEMBERS)]
    .sort((left, right) => Number(left) - Number(right)) as AigefsMember[];
}

function selectedQuantiles(
  request: QueryAtmosphereRequest | DiagnoseAtmosphereRequest,
): number[] {
  return [...(request.ensemble?.quantiles ?? DEFAULT_QUANTILES)].sort((a, b) => a - b);
}

function queryRequirement(request: QueryAtmosphereRequest): AigfsRunRequirement {
  const products = {
    pressure: (request.selection.variables?.length ?? 0) > 0,
    surface: (request.selection.fields?.length ?? 0) > 0,
  };
  return "at" in request.time
    ? { type: "valid_time", validTime: new Date(request.time.at), products }
    : {
        type: "time_range",
        startTime: new Date(request.time.from),
        endTime: new Date(request.time.to),
        products,
      };
}

function diagnosticRequirement(request: DiagnoseAtmosphereRequest): AigfsRunRequirement {
  const products = { pressure: true, surface: false };
  return "at" in request.time
    ? { type: "valid_time", validTime: new Date(request.time.at), products }
    : {
        type: "time_range",
        startTime: new Date(request.time.from),
        endTime: new Date(request.time.to),
        products,
      };
}

function aggregatePoint(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const states = samples.map(({ member, result }) => stateSample(
    member,
    result.gridPoint,
    result.levels,
    result.fields,
    result.source.cacheHit,
  ));
  const first = samples[0]!.result;
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    requestedPoint: first.requestedPoint,
    gridPoint: sharedGridPoint(states, "AIGEFS point"),
    selection: publicSelection(request, members, quantiles),
    ...aggregateState(states, request, quantiles),
    ...(request.ensemble?.includeMembers
      ? { members: publicStateMembers(states) }
      : {}),
    source: ensembleSource(samples),
  };
}

function aggregatePointRange(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const first = samples[0]!.result;
  const steps = first.series.map((step: any, stepIndex: number) => {
    const states = samples.map(({ member, result }) => {
      const candidate = alignedStep(result.series, stepIndex, step.validTime, "AIGEFS point time series");
      return stateSample(member, result.gridPoint, candidate.levels, candidate.fields, candidate.cacheHit);
    });
    return {
      validTime: step.validTime,
      forecastHour: step.forecastHour,
      ...aggregateState(states, request, quantiles),
    };
  });
  return {
    model: MODEL,
    run: run.toISOString(),
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    selection: publicSelection(request, members, quantiles),
    series: steps,
    source: ensembleSource(samples, false),
  };
}

function aggregatePoints(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const first = samples[0]!.result;
  const points = first.points.map((point: any, pointIndex: number) => {
    const states = samples.map(({ member, result }) => {
      const candidate = result.points[pointIndex];
      if (!candidate) throw new Error(`AIGEFS member ${member} is missing point ${pointIndex}`);
      return stateSample(
        member,
        candidate.gridPoint,
        candidate.levels,
        candidate.fields,
        result.source.cacheHit,
      );
    });
    return {
      requestedPoint: point.requestedPoint,
      gridPoint: sharedGridPoint(states, `AIGEFS point ${pointIndex}`),
      ...aggregateState(states, request, quantiles),
      ...(request.ensemble?.includeMembers
        ? { members: publicStateMembers(states) }
        : {}),
    };
  });
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    selection: publicSelection(request, members, quantiles),
    points,
    source: ensembleSource(samples),
  };
}

function aggregatePointsRange(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const first = samples[0]!.result;
  return {
    model: MODEL,
    run: run.toISOString(),
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    selection: publicSelection(request, members, quantiles),
    series: first.series.map((step: any, stepIndex: number) => ({
      validTime: step.validTime,
      forecastHour: step.forecastHour,
      points: step.points.map((point: any, pointIndex: number) => {
        const states = samples.map(({ member, result }) => {
          const memberStep = alignedStep(
            result.series,
            stepIndex,
            step.validTime,
            "AIGEFS points time series",
          );
          const candidate = memberStep.points[pointIndex];
          if (!candidate) throw new Error(
            `AIGEFS member ${member} is missing point ${pointIndex} at ${step.validTime}`,
          );
          return stateSample(
            member,
            candidate.gridPoint,
            candidate.levels,
            candidate.fields,
            memberStep.cacheHit,
          );
        });
        return {
          requestedPoint: point.requestedPoint,
          gridPoint: sharedGridPoint(states, `AIGEFS point ${pointIndex} at ${step.validTime}`),
          ...aggregateState(states, request, quantiles),
        };
      }),
    })),
    source: ensembleSource(samples, false),
  };
}

function aggregateTransect(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const first = samples[0]!.result;
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    startPoint: first.startPoint,
    endPoint: first.endPoint,
    totalDistanceKm: first.totalDistanceKm,
    selection: publicSelection(request, members, quantiles),
    samples: first.samples.map((sample: any, index: number) => {
      const states = samples.map(({ member, result }) => {
        const candidate = result.samples[index];
        if (!candidate) throw new Error(`AIGEFS member ${member} is missing transect sample ${index}`);
        return stateSample(
          member,
          candidate.gridPoint,
          candidate.levels,
          candidate.fields,
          result.source.cacheHit,
        );
      });
      return {
        index: sample.index,
        fraction: sample.fraction,
        distanceKm: sample.distanceKm,
        requestedPoint: sample.requestedPoint,
        gridPoint: sharedGridPoint(states, `AIGEFS transect sample ${index}`),
        ...aggregateState(states, request, quantiles),
        ...(request.ensemble?.includeMembers
          ? { members: publicStateMembers(states) }
          : {}),
      };
    }),
    source: ensembleSource(samples),
  };
}

function aggregateArea(
  request: QueryAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  const first = samples[0]!.result;
  const statistics = {
    definedGridPoints: summarizeNumericDistribution(
      samples.map(({ result }) => result.statistics.definedGridPoints),
      quantiles,
    ),
    mean: summarizeNumericDistribution(samples.map(({ result }) => result.statistics.mean), quantiles),
    min: summarizeNumericDistribution(samples.map(({ result }) => result.statistics.min), quantiles),
    max: summarizeNumericDistribution(samples.map(({ result }) => result.statistics.max), quantiles),
  };
  const result: any = {
    model: MODEL,
    run: run.toISOString(),
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    bbox: first.bbox,
    selection: {
      ...(first.variable === undefined
        ? { field: first.field }
        : { variable: first.variable }),
      members,
      quantiles,
    },
    methodology: "spatial_statistics_per_member_then_ensemble_distribution",
    statistics,
    source: ensembleSource(samples),
  };

  if ((request.aggregate?.percentiles?.length ?? 0) > 0) {
    result.spatialPercentiles = request.aggregate!.percentiles!.map((percentile, index) => ({
      percentile,
      percentileMethod: "linear_interpolation_sorted_defined_grid_points",
      distribution: summarizeNumericDistribution(
        samples.map(({ result: memberResult }) =>
          memberResult.distribution?.percentiles?.[index]?.value
          ?? missing(`AIGEFS area percentile ${percentile}`)),
        quantiles,
      ),
    }));
  }
  if ((request.aggregate?.thresholds?.length ?? 0) > 0) {
    result.spatialThresholdFractions = request.aggregate!.thresholds!.map((threshold, index) => ({
      operator: threshold.operator,
      threshold: threshold.value,
      distribution: summarizeNumericDistribution(
        samples.map(({ result: memberResult }) =>
          memberResult.distribution?.thresholdFractions?.[index]?.fraction
          ?? missing(`AIGEFS area threshold ${threshold.operator} ${threshold.value}`)),
        quantiles,
      ),
      interpretation: "distribution_of_raw_member_spatial_fractions_not_calibrated_probability",
    }));
  }
  if (request.aggregate?.includeExtremaLocations) {
    result.memberExtrema = samples.map(({ member, result: memberResult }) => ({
      member,
      ...(memberResult.distribution?.extrema
        ?? missing(`AIGEFS area extrema for member ${member}`)),
    }));
  }
  if (request.ensemble?.includeMembers) {
    result.members = samples.map(({ member, result: memberResult }) => ({
      member,
      cacheHit: memberResult.source.cacheHit,
      statistics: memberResult.statistics,
      ...(memberResult.distribution ?? {}),
    }));
  }
  return result;
}

function aggregateInstantDiagnostic(
  request: DiagnoseAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  if (request.diagnostic.kind === "parcel") {
    throw new Error("AIGEFS parcel diagnostics are unsupported");
  }
  const first = samples[0]!.result;
  if (request.diagnostic.kind === "layer") {
    const derivedMembers = samples.map(({ member, result }) => ({
      member,
      layer: result.layer,
      diagnostics: result.diagnostics,
    }));
    return {
      model: MODEL,
      run: run.toISOString(),
      validTime: first.validTime,
      forecastHour: first.forecastHour,
      requestedPoint: first.requestedPoint,
      gridPoint: sharedDiagnosticGrid(samples),
      layer: {
        lowerPressureHpa: request.diagnostic.lowerPressureHpa,
        upperPressureHpa: request.diagnostic.upperPressureHpa,
      },
      selection: {
        diagnostics: request.diagnostic.diagnostics,
        members,
        quantiles,
      },
      ...summarizeEnsembleLayerDiagnostics(
        request.diagnostic.diagnostics,
        derivedMembers,
        quantiles,
      ),
      ...(request.ensemble?.includeMembers
        ? {
            members: samples.map(({ member, result }) => ({
              member,
              cacheHit: result.source.cacheHit,
              layer: result.layer,
              levels: result.levels,
              diagnostics: result.diagnostics,
            })),
          }
        : {}),
      source: ensembleSource(samples),
    };
  }

  const derivedMembers = samples.map(({ member, result }) => ({
    member,
    diagnostics: result.diagnostics,
  }));
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: first.validTime,
    forecastHour: first.forecastHour,
    requestedPoint: first.requestedPoint,
    gridPoint: sharedDiagnosticGrid(samples),
    sampledPressureLevelsHpa: request.diagnostic.pressureLevelsHpa,
    selection: {
      diagnostics: request.diagnostic.diagnostics,
      members,
      quantiles,
    },
    summaries: summarizeEnsembleProfileDiagnostics(
      request.diagnostic.diagnostics,
      derivedMembers,
      quantiles,
    ),
    ...(request.ensemble?.includeMembers
      ? {
          members: samples.map(({ member, result }) => ({
            member,
            cacheHit: result.source.cacheHit,
            levels: result.levels,
            diagnostics: result.diagnostics,
          })),
        }
      : {}),
    source: ensembleSource(samples),
  };
}

function aggregateDiagnosticRange(
  request: DiagnoseAtmosphereRequest,
  run: Date,
  samples: MemberResult[],
  members: AigefsMember[],
  quantiles: number[],
) {
  if (request.diagnostic.kind === "parcel") {
    throw new Error("AIGEFS parcel diagnostic ranges are unsupported");
  }
  const diagnostic = request.diagnostic;
  const first = samples[0]!.result;
  return {
    model: MODEL,
    run: run.toISOString(),
    requestedStartTime: first.requestedStartTime,
    requestedEndTime: first.requestedEndTime,
    requestedPoint: first.requestedPoint,
    gridPoint: first.gridPoint,
    diagnostic,
    selection: { members, quantiles },
    series: first.series.map((step: any, stepIndex: number) => {
      const aligned = samples.map(({ member, result }) => ({
        member,
        result: alignedStep(
          result.series,
          stepIndex,
          step.validTime,
          "AIGEFS diagnostic time series",
        ),
      }));
      if (diagnostic.kind === "layer") {
        const summary = summarizeEnsembleLayerDiagnostics(
          diagnostic.diagnostics,
          aligned.map(({ member, result }) => ({
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
          ...summary,
        };
      }
      return {
        kind: "profile",
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        summaries: summarizeEnsembleProfileDiagnostics(
          diagnostic.diagnostics,
          aligned.map(({ member, result }) => ({ member, diagnostics: result.diagnostics })),
          quantiles,
        ),
      };
    }),
    source: ensembleSource(samples, false),
  };
}

function aggregateState(
  states: StateSample[],
  request: QueryAtmosphereRequest,
  quantiles: number[],
) {
  const variables = request.selection.variables ?? [];
  const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
  const fields = request.selection.fields ?? [];

  const pressureSummaries = pressureLevelsHpa.flatMap((pressureLevelHpa) =>
    variables.flatMap((variable) => {
      const definition = VARIABLE_CATALOG[variable as keyof typeof VARIABLE_CATALOG];
      if (!definition) throw new Error(`Unknown AIGEFS pressure variable ${variable}`);
      return definition.outputs.map((output) => {
        const values = states.map((state) => {
          const level = state.levels.find((candidate) => candidate.pressureHpa === pressureLevelHpa);
          const value = level?.[output.field];
          if (typeof value !== "number") {
            throw new Error(
              `AIGEFS member ${state.member} is missing ${variable}.${output.field}@${pressureLevelHpa}hPa`,
            );
          }
          return value;
        });
        return output.field === "windDirectionDeg"
          ? {
              variable,
              pressureLevelHpa,
              aggregation: "circular_direction" as const,
              field: output.field,
              unit: output.unit,
              ...summarizeCircularDegrees(values),
            }
          : {
              variable,
              pressureLevelHpa,
              aggregation: "numeric_distribution" as const,
              field: output.field,
              unit: output.unit,
              distribution: summarizeNumericDistribution(values, quantiles),
            };
      });
    }),
  );

  const fieldSummaries = fields.map((field) => {
    const definition = NON_ISOBARIC_FIELD_CATALOG[field as keyof typeof NON_ISOBARIC_FIELD_CATALOG];
    if (!definition) throw new Error(`Unknown AIGEFS field ${field}`);
    const memberFields = states.map((state) => {
      const candidate = state.fields?.find((value) => value.id === field);
      if (!candidate) throw new Error(`AIGEFS member ${state.member} is missing field ${field}`);
      return candidate;
    });
    const first = memberFields[0]!;
    for (const candidate of memberFields) {
      if (JSON.stringify(candidate.level) !== JSON.stringify(first.level)
        || JSON.stringify(candidate.temporal) !== JSON.stringify(first.temporal)) {
        throw new Error(`AIGEFS field ${field} has inconsistent member metadata`);
      }
    }
    return {
      field,
      level: first.level,
      temporal: first.temporal,
      outputs: definition.outputs.map((output) => {
        const values = memberFields.map((candidate, index) => {
          const value = candidate.values[output.field];
          if (typeof value !== "number") {
            throw new Error(
              `AIGEFS member ${states[index]!.member} is missing ${field}.${output.field}`,
            );
          }
          return value;
        });
        return output.field === "windDirectionDeg"
          ? {
              aggregation: "circular_direction" as const,
              field: output.field,
              unit: output.unit,
              ...summarizeCircularDegrees(values),
            }
          : {
              aggregation: "numeric_distribution" as const,
              field: output.field,
              unit: output.unit,
              distribution: summarizeNumericDistribution(values, quantiles),
            };
      }),
    };
  });

  return { pressureSummaries, fieldSummaries };
}

function publicSelection(
  request: QueryAtmosphereRequest,
  members: AigefsMember[],
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

function stateSample(
  member: AigefsMember,
  gridPoint: { latitude: number; longitude: number },
  levels: any[],
  fields: any[] | undefined,
  cacheHit: boolean,
): StateSample {
  return {
    member,
    gridPoint,
    levels,
    cacheHit,
    ...(fields === undefined ? {} : { fields }),
  };
}

function publicStateMembers(states: StateSample[]) {
  return states.map(({ member, cacheHit, levels, fields }) => ({
    member,
    cacheHit,
    levels,
    ...(fields === undefined ? {} : { fields }),
  }));
}

function sharedGridPoint(
  states: StateSample[],
  context: string,
): { latitude: number; longitude: number } {
  const first = states[0]?.gridPoint;
  if (!first) throw new Error(`${context} produced no member samples`);
  for (const state of states) {
    if (state.gridPoint.latitude !== first.latitude || state.gridPoint.longitude !== first.longitude) {
      throw new Error(`${context} resolved members to inconsistent grid points`);
    }
  }
  return first;
}

function sharedDiagnosticGrid(samples: MemberResult[]) {
  return sharedGridPoint(
    samples.map(({ member, result }) =>
      stateSample(member, result.gridPoint, result.levels ?? [], result.fields, result.source.cacheHit)),
    "AIGEFS diagnostic",
  );
}

function alignedStep(
  series: any[],
  index: number,
  validTime: string,
  context: string,
) {
  const step = series[index];
  if (!step || step.validTime !== validTime) {
    throw new Error(`${context} member series are not aligned at ${validTime}`);
  }
  return step;
}

function ensembleSource(samples: MemberResult[], includeCache = true) {
  const first = samples[0]?.result?.source;
  if (!first) throw new Error("AIGEFS produced no source provenance");
  const cacheHits = samples.map(({ result }) =>
    typeof result.source?.cacheHit === "boolean"
      ? result.source.cacheHit
      : result.series?.every((step: any) => step.cacheHit === true) === true);
  return {
    provider: "NOAA NOMADS" as const,
    access: "nomads_range" as const,
    decoder: first.decoder ?? "gribberish",
    horizontalGridDegrees: 0.25,
    memberPopulation: "000-030" as const,
    ...(includeCache ? { allCacheHit: cacheHits.every(Boolean) } : {}),
  };
}

function missing(message: string): never {
  throw new Error(`Internal ${message} aggregation value is missing`);
}
