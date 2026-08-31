import { homedir } from "node:os";
import { join } from "node:path";
import { AigefsS3SubsetCache } from "../cache/aigefs-s3-subset-cache.js";
import { AIGEFS_MEMBERS, type AigefsMember } from "../catalog/aigefs.js";
import { GEFS_MEMBERS, type GefsMember } from "../catalog/gefs.js";
import {
  HGEFS_MEMBERS,
  gefsVariablesForHgefs,
  hgefsMember,
  sortHgefsMembers,
  splitHgefsMembers,
  type HgefsMember,
  type HgefsPopulation,
} from "../catalog/hgefs.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
  type NonIsobaricLevel,
} from "../catalog/non-isobaric-fields.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type { VariableId } from "../schema/query.js";
import {
  aigfsForecastHour,
  aigfsNativeForecastHoursInRange,
  aigfsValidTime,
  parseAigfsRun,
} from "../sources/aigfs.js";
import { AigefsForecastService } from "./aigefs.js";
import {
  AigfsRunResolver,
  type AigfsRunProvider,
  type AigfsRunRequirement,
} from "./aigfs-run.js";
import { memberValuesToLevels } from "./atmospheric-profile.js";
import { applyDerivedPressureValues } from "./profile.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import { GefsDiagnosticAdapter } from "./diagnostic-adapters/gefs.js";
import { GefsQueryAdapter } from "./query-adapters/gefs.js";
import type {
  NonIsobaricFieldResult,
  ProfileDiagnosticResult,
  ProfileLevel,
} from "./types.js";

const MODEL = "hgefs_0p25" as const;
const HGEFS_MAX_FORECAST_HOUR = 240;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const DEFAULT_STEP_CONCURRENCY = 2;
const MAX_HGEFS_NATIVE_STEPS = 41;
const MEMBER_SET = new Set<string>(HGEFS_MEMBERS);

export interface HgefsQueryConstituent {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
}

export interface HgefsDiagnosticConstituent {
  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;
}

export interface HgefsForecastServiceOptions {
  cacheDir?: string;
  runProvider?: AigfsRunProvider;
  aigefs?: HgefsQueryConstituent & HgefsDiagnosticConstituent;
  gefsQuery?: HgefsQueryConstituent;
  gefsDiagnostics?: HgefsDiagnosticConstituent;
  stepConcurrency?: number;
}

interface HybridMemberSnapshot {
  member: HgefsMember;
  population: HgefsPopulation;
  modelClass: "physics" | "ai";
  cacheHit: boolean;
  gridPoint?: { latitude: number; longitude: number };
  levels: ProfileLevel[];
  fields?: NonIsobaricFieldResult[];
}

interface HybridAreaMember {
  member: HgefsMember;
  population: HgefsPopulation;
  modelClass: "physics" | "ai";
  cacheHit: boolean;
  statistics: {
    definedGridPoints: number;
    mean: number;
    min: number;
    max: number;
  };
  distribution?: {
    percentiles?: Array<{ percentile: number; value: number }>;
    thresholdFractions?: Array<{
      operator: "gte" | "lte";
      threshold: number;
      matchingGridPoints: number;
      fraction: number;
    }>;
    extrema?: Record<string, unknown>;
  };
}

interface ConstituentQueryResults {
  aigefs?: any;
  gefs?: any;
  selectedAigefs: AigefsMember[];
  selectedGefs: GefsMember[];
}

export class HgefsForecastService {
  private readonly runProvider: AigfsRunProvider;
  private readonly aigefs: HgefsQueryConstituent & HgefsDiagnosticConstituent;
  private readonly gefsQuery: HgefsQueryConstituent;
  private readonly gefsDiagnostics: HgefsDiagnosticConstituent;
  private readonly stepConcurrency: number;

  constructor(options: HgefsForecastServiceOptions = {}) {
    const cacheDir = options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.runProvider = options.runProvider ?? new AigfsRunResolver(
      new AigefsS3SubsetCache(
        join(cacheDir, "hgefs-run-probe", "aigefs-c00"),
        "c00",
      ),
    );
    this.aigefs = options.aigefs ?? new AigefsForecastService({ cacheDir });
    this.gefsQuery = options.gefsQuery ?? new GefsQueryAdapter({ cacheDir });
    this.gefsDiagnostics = options.gefsDiagnostics ?? new GefsDiagnosticAdapter();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_STEP_CONCURRENCY;
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "hgefs") {
      throw new Error("HGEFS service only accepts dataset=hgefs");
    }
    const members = requestedMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);
    const run = await this.resolveRun(request, productsForQuery(request));

    if ("at" in request.time) {
      return this.queryInstant(request, run, new Date(request.time.at), members, quantiles);
    }

    const times = nativeTimes(
      run,
      new Date(request.time.from),
      new Date(request.time.to),
      request.time.maxSteps,
    );
    const steps = await mapConcurrent(times, this.stepConcurrency, async (validTime) =>
      this.queryInstant(
        {
          ...request,
          time: { at: validTime.toISOString() },
          forecast: { ...(request.forecast ?? {}), run: run.toISOString() },
        } as QueryAtmosphereRequest,
        run,
        validTime,
        members,
        quantiles,
      ) as Promise<any>,
    );
    const first = steps[0];
    if (!first) throw new Error("HGEFS range query produced no native forecast steps");

    if (request.geometry.type === "point") {
      return {
        model: MODEL,
        run: run.toISOString(),
        requestedStartTime: request.time.from,
        requestedEndTime: request.time.to,
        requestedPoint: { ...request.geometry },
        selection: hybridSelection(request, members, quantiles),
        constituentGridPoints: first.constituentGridPoints,
        series: steps.map(compactPointStep),
        source: rangeSource(steps),
      };
    }
    if (request.geometry.type === "points") {
      return {
        model: MODEL,
        run: run.toISOString(),
        requestedStartTime: request.time.from,
        requestedEndTime: request.time.to,
        selection: hybridSelection(request, members, quantiles),
        series: steps.map(compactPointsStep),
        source: rangeSource(steps),
      };
    }
    throw new Error("Internal HGEFS routing error: range geometry must be point or points");
  }

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "hgefs") {
      throw new Error("HGEFS service only accepts dataset=hgefs");
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "HGEFS does not expose parcel diagnostics because the AIGEFS constituent lacks the required surface parcel initialization state",
      );
    }
    const members = requestedMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);
    const run = await this.resolveRun(request, { pressure: true, surface: false });

    if ("at" in request.time) {
      return this.diagnoseInstant(request, run, new Date(request.time.at), members, quantiles);
    }

    const times = nativeTimes(
      run,
      new Date(request.time.from),
      new Date(request.time.to),
      request.time.maxSteps,
    );
    const steps = await mapConcurrent(times, this.stepConcurrency, async (validTime) =>
      this.diagnoseInstant(
        {
          ...request,
          time: { at: validTime.toISOString() },
          forecast: { ...(request.forecast ?? {}), run: run.toISOString() },
          ensemble: {
            ...(request.ensemble ?? {}),
            members,
            quantiles,
            includeMembers: false,
          },
        } as DiagnoseAtmosphereRequest,
        run,
        validTime,
        members,
        quantiles,
      ) as Promise<any>,
    );
    const first = steps[0];
    if (!first) throw new Error("HGEFS diagnostic range produced no native forecast steps");

    return {
      model: MODEL,
      run: run.toISOString(),
      requestedStartTime: request.time.from,
      requestedEndTime: request.time.to,
      requestedPoint: { ...request.geometry },
      diagnostic: request.diagnostic,
      selection: hybridDiagnosticSelection(members, quantiles),
      constituentGridPoints: first.constituentGridPoints,
      series: steps.map((step) => request.diagnostic.kind === "layer"
        ? {
            kind: "layer" as const,
            validTime: step.validTime,
            forecastHour: step.forecastHour,
            pressureLayer: step.pressureLayer,
            layerDepthGpm: step.layerDepthGpm,
            summaries: step.summaries,
          }
        : {
            kind: "profile" as const,
            validTime: step.validTime,
            forecastHour: step.forecastHour,
            sampledPressureLevelsHpa: step.sampledPressureLevelsHpa,
            summaries: step.summaries,
          }),
      source: rangeSource(steps),
    };
  }

  private async resolveRun(
    request: QueryAtmosphereRequest | DiagnoseAtmosphereRequest,
    products: { pressure: boolean; surface: boolean },
  ): Promise<Date> {
    const selector = request.forecast?.run ?? "latest";
    if (selector === "latest_complete") {
      throw new Error("HGEFS supports latest or an explicit run, not latest_complete");
    }
    if (selector !== "latest") return parseAigfsRun(selector);

    const requirement: AigfsRunRequirement = "at" in request.time
      ? {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products,
        }
      : {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products,
        };
    const run = await this.runProvider.resolveLatestRun(requirement);
    assertWithinHgefsHorizon(run, request.time);
    return run;
  }

  private async queryInstant(
    request: QueryAtmosphereRequest,
    run: Date,
    validTime: Date,
    members: HgefsMember[],
    quantiles: number[],
  ): Promise<unknown> {
    const forecastHour = hgefsForecastHour(run, validTime);
    const constituents = await this.queryConstituents(
      request,
      run,
      validTime,
      members,
      quantiles,
    );

    switch (request.geometry.type) {
      case "point":
        return summarizePointInstant(
          request,
          run,
          validTime,
          forecastHour,
          members,
          quantiles,
          constituents,
        );
      case "points":
        return summarizePointsInstant(
          request,
          run,
          validTime,
          forecastHour,
          members,
          quantiles,
          constituents,
        );
      case "transect":
        return summarizeTransect(
          request,
          run,
          validTime,
          forecastHour,
          members,
          quantiles,
          constituents,
        );
      case "area":
        return summarizeArea(
          request,
          run,
          validTime,
          forecastHour,
          members,
          quantiles,
          constituents,
        );
    }
  }

  private async queryConstituents(
    request: QueryAtmosphereRequest,
    run: Date,
    validTime: Date,
    members: HgefsMember[],
    quantiles: number[],
  ): Promise<ConstituentQueryResults> {
    const split = splitHgefsMembers(members);
    const runIso = run.toISOString();
    const time = { at: validTime.toISOString() };
    const tasks: Array<Promise<void>> = [];
    const result: ConstituentQueryResults = {
      selectedAigefs: split.aigefs,
      selectedGefs: split.gefs,
    };

    if (split.aigefs.length > 0) {
      tasks.push((async () => {
        result.aigefs = await this.aigefs.query({
          ...request,
          dataset: "aigefs",
          time,
          forecast: { ...(request.forecast ?? {}), run: runIso },
          ensemble: {
            members: paddedMembers(split.aigefs, AIGEFS_MEMBERS),
            quantiles,
            includeMembers: true,
            maxMemberSamples: 20_000,
          },
          source: undefined,
        } as QueryAtmosphereRequest);
      })());
    }

    if (split.gefs.length > 0) {
      tasks.push((async () => {
        const variables = request.selection.variables ?? [];
        result.gefs = await this.gefsQuery.query({
          ...request,
          dataset: "gefs",
          time,
          selection: {
            variables: variables.length === 0
              ? undefined
              : gefsVariablesForHgefs(variables as VariableId[]),
            pressureLevelsHpa: request.selection.pressureLevelsHpa,
            fields: request.selection.fields,
          },
          forecast: { run: runIso },
          ensemble: {
            members: paddedMembers(split.gefs, GEFS_MEMBERS),
            quantiles,
            includeMembers: true,
            maxMemberSamples: 20_000,
          },
          source: undefined,
        } as QueryAtmosphereRequest);
      })());
    }

    await Promise.all(tasks);
    assertConstituentAlignment(result, runIso, validTime.toISOString());
    return result;
  }

  private async diagnoseInstant(
    request: DiagnoseAtmosphereRequest,
    run: Date,
    validTime: Date,
    members: HgefsMember[],
    quantiles: number[],
  ): Promise<unknown> {
    const forecastHour = hgefsForecastHour(run, validTime);
    const split = splitHgefsMembers(members);
    const runIso = run.toISOString();
    const time = { at: validTime.toISOString() };
    let aigefs: any;
    let gefs: any;

    await Promise.all([
      split.aigefs.length === 0
        ? Promise.resolve()
        : this.aigefs.diagnose({
            ...request,
            dataset: "aigefs",
            time,
            forecast: { ...(request.forecast ?? {}), run: runIso },
            ensemble: {
              members: paddedMembers(split.aigefs, AIGEFS_MEMBERS),
              quantiles,
              includeMembers: true,
            },
            source: undefined,
          } as DiagnoseAtmosphereRequest).then((value) => { aigefs = value; }),
      split.gefs.length === 0
        ? Promise.resolve()
        : this.gefsDiagnostics.diagnose({
            ...request,
            dataset: "gefs",
            time,
            forecast: { run: runIso },
            ensemble: {
              members: paddedMembers(split.gefs, GEFS_MEMBERS),
              quantiles,
              includeMembers: true,
            },
            source: undefined,
          } as DiagnoseAtmosphereRequest).then((value) => { gefs = value; }),
    ]);

    assertConstituentAlignment(
      { aigefs, gefs, selectedAigefs: split.aigefs, selectedGefs: split.gefs },
      runIso,
      validTime.toISOString(),
    );

    const source = hybridSource([
      ...(aigefs === undefined ? [] : [{
        population: "aigefs" as const,
        modelClass: "ai" as const,
        selectedMemberCount: split.aigefs.length,
        result: aigefs,
      }]),
      ...(gefs === undefined ? [] : [{
        population: "gefs" as const,
        modelClass: "physics" as const,
        selectedMemberCount: split.gefs.length,
        result: gefs,
      }]),
    ]);

    if (request.diagnostic.kind === "layer") {
      const memberDiagnostics = [
        ...diagnosticLayerMembers("aigefs", split.aigefs, aigefs),
        ...diagnosticLayerMembers("gefs", split.gefs, gefs),
      ];
      const aggregate = summarizeEnsembleLayerDiagnostics(
        request.diagnostic.diagnostics,
        memberDiagnostics.map((entry) => ({
          member: entry.member,
          layer: entry.layer,
          diagnostics: entry.diagnostics,
        })),
        quantiles,
      );
      return {
        model: MODEL,
        run: runIso,
        validTime: validTime.toISOString(),
        forecastHour,
        requestedPoint: { ...request.geometry },
        constituentGridPoints: diagnosticGridPoints(aigefs, gefs),
        pressureLayer: {
          lowerPressureHpa: request.diagnostic.lowerPressureHpa,
          upperPressureHpa: request.diagnostic.upperPressureHpa,
        },
        selection: {
          diagnostics: request.diagnostic.diagnostics,
          ...hybridDiagnosticSelection(members, quantiles),
        },
        layerDepthGpm: aggregate.layerDepthGpm,
        summaries: aggregate.summaries,
        ...(request.ensemble?.includeMembers
          ? { members: memberDiagnostics }
          : {}),
        source,
      };
    }

    const memberProfiles = [
      ...diagnosticProfileMembers("aigefs", split.aigefs, aigefs),
      ...diagnosticProfileMembers("gefs", split.gefs, gefs),
    ];
    return {
      model: MODEL,
      run: runIso,
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { ...request.geometry },
      constituentGridPoints: diagnosticGridPoints(aigefs, gefs),
      sampledPressureLevelsHpa: request.diagnostic.pressureLevelsHpa,
      selection: {
        diagnostics: request.diagnostic.diagnostics,
        ...hybridDiagnosticSelection(members, quantiles),
      },
      summaries: summarizeEnsembleProfileDiagnostics(
        request.diagnostic.diagnostics,
        memberProfiles.map((entry) => ({
          member: entry.member,
          diagnostics: entry.diagnostics,
        })),
        quantiles,
      ),
      ...(request.ensemble?.includeMembers
        ? { members: memberProfiles }
        : {}),
      source,
    };
  }
}

function requestedMembers(input: readonly string[] | undefined): HgefsMember[] {
  const raw = input ?? HGEFS_MEMBERS;
  const unsupported = raw.filter((member) => !MEMBER_SET.has(member));
  if (unsupported.length > 0) {
    throw new Error(
      `HGEFS members use gefs:c00..p30 or aigefs:c00..p30; unsupported: ${unsupported.join(", ")}`,
    );
  }
  if (raw.length < 2) throw new Error("HGEFS requires at least two selected members");
  return sortHgefsMembers(raw as HgefsMember[]);
}

function requestedQuantiles(input: readonly number[] | undefined): number[] {
  return [...(input ?? DEFAULT_QUANTILES)].sort((left, right) => left - right);
}

function paddedMembers<T extends string>(
  selected: readonly T[],
  population: readonly T[],
): T[] {
  if (selected.length >= 2) return [...selected];
  const first = selected[0];
  if (first === undefined) return [];
  const spare = population.find((candidate) => candidate !== first);
  if (spare === undefined) throw new Error("HGEFS constituent population has no spare member");
  return [first, spare];
}

function productsForQuery(request: QueryAtmosphereRequest) {
  return {
    pressure: (request.selection.variables?.length ?? 0) > 0,
    surface: (request.selection.fields?.length ?? 0) > 0,
  };
}

function assertWithinHgefsHorizon(
  run: Date,
  time: QueryAtmosphereRequest["time"] | DiagnoseAtmosphereRequest["time"],
): void {
  if ("at" in time) {
    hgefsForecastHour(run, new Date(time.at));
    return;
  }
  const endLead = (new Date(time.to).getTime() - run.getTime()) / 3_600_000;
  if (endLead > HGEFS_MAX_FORECAST_HOUR) {
    throw new Error(
      `Requested time range extends beyond the ${HGEFS_MAX_FORECAST_HOUR}-hour HGEFS horizon`,
    );
  }
}

function hgefsForecastHour(run: Date, validTime: Date): number {
  const forecastHour = aigfsForecastHour(run, validTime);
  if (forecastHour > HGEFS_MAX_FORECAST_HOUR) {
    throw new Error(
      `HGEFS forecast hour must be at most ${HGEFS_MAX_FORECAST_HOUR}; received ${forecastHour}`,
    );
  }
  return forecastHour;
}

function nativeTimes(
  run: Date,
  startTime: Date,
  endTime: Date,
  requestedMaxSteps: number | undefined,
): Date[] {
  if (endTime.getTime() > run.getTime() + HGEFS_MAX_FORECAST_HOUR * 3_600_000) {
    throw new Error(
      `Requested time range extends beyond the ${HGEFS_MAX_FORECAST_HOUR}-hour HGEFS horizon`,
    );
  }
  const hours = aigfsNativeForecastHoursInRange(run, startTime, endTime)
    .filter((forecastHour) => forecastHour <= HGEFS_MAX_FORECAST_HOUR);
  const maxSteps = requestedMaxSteps ?? MAX_HGEFS_NATIVE_STEPS;
  if (hours.length > maxSteps) {
    throw new Error(
      `Requested HGEFS time range contains ${hours.length} native 6-hour outputs, exceeding maxSteps=${maxSteps}`,
    );
  }
  return hours.map((forecastHour) => aigfsValidTime(run, forecastHour));
}

function assertConstituentAlignment(
  results: ConstituentQueryResults,
  run: string,
  validTime: string,
): void {
  for (const [name, result] of [["AIGEFS", results.aigefs], ["GEFS", results.gefs]] as const) {
    if (result === undefined) continue;
    if (result.run !== run) {
      throw new Error(`HGEFS ${name} constituent drifted from the common initialization cycle`);
    }
    if (result.validTime !== validTime) {
      throw new Error(`HGEFS ${name} constituent returned an inconsistent valid time`);
    }
  }
}

function summarizePointInstant(
  request: QueryAtmosphereRequest,
  run: Date,
  validTime: Date,
  forecastHour: number,
  members: HgefsMember[],
  quantiles: number[],
  constituents: ConstituentQueryResults,
) {
  const snapshots = pointSnapshots(request, constituents);
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    requestedPoint: { ...request.geometry },
    constituentGridPoints: gridPointsFromSnapshots(snapshots),
    selection: hybridSelection(request, members, quantiles),
    ...profileSummaries(snapshots.map((snapshot) => snapshot), quantiles),
    ...(request.ensemble?.includeMembers
      ? { members: snapshots.map(publicSnapshot) }
      : {}),
    source: querySource(constituents),
  };
}

function summarizePointsInstant(
  request: QueryAtmosphereRequest,
  run: Date,
  validTime: Date,
  forecastHour: number,
  members: HgefsMember[],
  quantiles: number[],
  constituents: ConstituentQueryResults,
) {
  if (request.geometry.type !== "points") {
    throw new Error("Internal HGEFS routing error: expected points geometry");
  }
  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    selection: hybridSelection(request, members, quantiles),
    points: request.geometry.points.map((requestedPoint, pointIndex) => {
      const snapshots = pointIndexSnapshots(request, constituents, pointIndex);
      return {
        requestedPoint,
        constituentGridPoints: gridPointsFromSnapshots(snapshots),
        ...profileSummaries(snapshots, quantiles),
        ...(request.ensemble?.includeMembers
          ? { members: snapshots.map(publicSnapshot) }
          : {}),
      };
    }),
    source: querySource(constituents),
  };
}

function summarizeTransect(
  request: QueryAtmosphereRequest,
  run: Date,
  validTime: Date,
  forecastHour: number,
  members: HgefsMember[],
  quantiles: number[],
  constituents: ConstituentQueryResults,
) {
  if (request.geometry.type !== "transect") {
    throw new Error("Internal HGEFS routing error: expected transect geometry");
  }
  const sampleCount = request.geometry.samples ?? 20;
  const reference = constituents.aigefs?.samples ?? constituents.gefs?.samples;
  if (!Array.isArray(reference) || reference.length !== sampleCount) {
    throw new Error("HGEFS constituent transect returned an inconsistent sample count");
  }

  return {
    model: MODEL,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    startPoint: request.geometry.start,
    endPoint: request.geometry.end,
    totalDistanceKm: reference[0] === undefined
      ? 0
      : (constituents.aigefs?.totalDistanceKm ?? constituents.gefs?.totalDistanceKm),
    selection: hybridSelection(request, members, quantiles),
    samples: reference.map((sample: any, index: number) => {
      const snapshots = transectSnapshots(request, constituents, index);
      return {
        index: sample.index,
        fraction: sample.fraction,
        distanceKm: sample.distanceKm,
        requestedPoint: sample.requestedPoint,
        constituentGridPoints: gridPointsFromSnapshots(snapshots),
        ...profileSummaries(snapshots, quantiles),
        ...(request.ensemble?.includeMembers
          ? { members: snapshots.map(publicSnapshot) }
          : {}),
      };
    }),
    source: querySource(constituents),
  };
}

function summarizeArea(
  request: QueryAtmosphereRequest,
  run: Date,
  validTime: Date,
  forecastHour: number,
  members: HgefsMember[],
  quantiles: number[],
  constituents: ConstituentQueryResults,
) {
  if (request.geometry.type !== "area") {
    throw new Error("Internal HGEFS routing error: expected area geometry");
  }
  const areaMembers = areaMemberResults(constituents);
  const result: any = {
    model: MODEL,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    bbox: {
      westLongitude: request.geometry.westLongitude,
      eastLongitude: request.geometry.eastLongitude,
      southLatitude: request.geometry.southLatitude,
      northLatitude: request.geometry.northLatitude,
    },
    selection: hybridSelection(request, members, quantiles),
    methodology:
      "spatial_statistics_per_constituent_member_then_hybrid_distribution_native_grids_preserved",
    statistics: {
      mean: summarizeNumericDistribution(areaMembers.map((entry) => entry.statistics.mean), quantiles),
      min: summarizeNumericDistribution(areaMembers.map((entry) => entry.statistics.min), quantiles),
      max: summarizeNumericDistribution(areaMembers.map((entry) => entry.statistics.max), quantiles),
    },
    definedGridPointsByPopulation: ["gefs", "aigefs"]
      .flatMap((population) => {
        const selected = areaMembers.filter((entry) => entry.population === population);
        return selected.length === 0
          ? []
          : [{
              population,
              modelClass: population === "gefs" ? "physics" : "ai",
              distribution: summarizeNumericDistribution(
                selected.map((entry) => entry.statistics.definedGridPoints),
                quantiles,
              ),
            }];
      }),
    source: querySource(constituents),
  };

  const percentiles = request.aggregate?.percentiles ?? [];
  if (percentiles.length > 0) {
    result.spatialPercentiles = percentiles.map((percentile) => ({
      percentile,
      percentileMethod: "linear_interpolation_sorted_defined_grid_points",
      distribution: summarizeNumericDistribution(
        areaMembers.map((entry) =>
          requiredAreaPercentile(entry, percentile)),
        quantiles,
      ),
    }));
  }

  const thresholds = request.aggregate?.thresholds ?? [];
  if (thresholds.length > 0) {
    result.spatialThresholdFractions = thresholds.map((threshold) => ({
      operator: threshold.operator,
      threshold: threshold.value,
      distribution: summarizeNumericDistribution(
        areaMembers.map((entry) =>
          requiredAreaThresholdFraction(entry, threshold)),
        quantiles,
      ),
      interpretation:
        "distribution_of_raw_member_spatial_fractions_not_calibrated_probability",
    }));
  }

  if (request.aggregate?.includeExtremaLocations === true) {
    result.memberExtrema = areaMembers.map((entry) => ({
      member: entry.member,
      population: entry.population,
      modelClass: entry.modelClass,
      ...requiredObject(entry.distribution?.extrema, `HGEFS extrema for ${entry.member}`),
    }));
  }

  if (request.ensemble?.includeMembers === true) {
    result.members = areaMembers.map((entry) => ({
      member: entry.member,
      population: entry.population,
      modelClass: entry.modelClass,
      cacheHit: entry.cacheHit,
      statistics: entry.statistics,
      ...(entry.distribution === undefined ? {} : { distribution: entry.distribution }),
    }));
  }

  return result;
}

function pointSnapshots(
  request: QueryAtmosphereRequest,
  constituents: ConstituentQueryResults,
): HybridMemberSnapshot[] {
  if (request.geometry.type !== "point") {
    throw new Error("Internal HGEFS routing error: expected point");
  }
  return [
    ...aigefsPointSnapshots(constituents.selectedAigefs, constituents.aigefs),
    ...gefsPointSnapshots(request, constituents.selectedGefs, constituents.gefs),
  ];
}

function pointIndexSnapshots(
  request: QueryAtmosphereRequest,
  constituents: ConstituentQueryResults,
  pointIndex: number,
): HybridMemberSnapshot[] {
  const snapshots: HybridMemberSnapshot[] = [];
  if (constituents.aigefs !== undefined) {
    for (const member of constituents.selectedAigefs) {
      const rawMember = requiredMember(constituents.aigefs.members, member, "AIGEFS");
      const point = rawMember.points?.[pointIndex];
      if (point === undefined) throw new Error(`HGEFS AIGEFS member ${member} is missing point ${pointIndex}`);
      snapshots.push({
        member: hgefsMember("aigefs", member),
        population: "aigefs",
        modelClass: "ai",
        cacheHit: rawMember.cacheHit ?? constituents.aigefs.source?.allCacheHit ?? false,
        gridPoint: point.gridPoint,
        levels: point.levels,
        ...(point.fields === undefined ? {} : { fields: point.fields }),
      });
    }
  }
  if (constituents.gefs !== undefined) {
    const point = constituents.gefs.points?.[pointIndex];
    if (point === undefined) throw new Error(`HGEFS GEFS result is missing point ${pointIndex}`);
    for (const member of constituents.selectedGefs) {
      const rawMember = requiredMember(point.members, member, "GEFS");
      snapshots.push(normalizeGefsMember(
        request,
        member,
        rawMember,
        point.gridPoint,
      ));
    }
  }
  return snapshots;
}

function transectSnapshots(
  request: QueryAtmosphereRequest,
  constituents: ConstituentQueryResults,
  sampleIndex: number,
): HybridMemberSnapshot[] {
  const snapshots: HybridMemberSnapshot[] = [];
  if (constituents.aigefs !== undefined) {
    for (const member of constituents.selectedAigefs) {
      const rawMember = requiredMember(constituents.aigefs.members, member, "AIGEFS");
      const sample = rawMember.samples?.[sampleIndex];
      if (sample === undefined) {
        throw new Error(`HGEFS AIGEFS member ${member} is missing transect sample ${sampleIndex}`);
      }
      snapshots.push({
        member: hgefsMember("aigefs", member),
        population: "aigefs",
        modelClass: "ai",
        cacheHit: rawMember.cacheHit ?? constituents.aigefs.source?.allCacheHit ?? false,
        gridPoint: sample.gridPoint,
        levels: sample.levels,
        ...(sample.fields === undefined ? {} : { fields: sample.fields }),
      });
    }
  }
  if (constituents.gefs !== undefined) {
    const sample = constituents.gefs.samples?.[sampleIndex];
    if (sample === undefined) {
      throw new Error(`HGEFS GEFS result is missing transect sample ${sampleIndex}`);
    }
    for (const member of constituents.selectedGefs) {
      const rawMember = requiredMember(sample.members, member, "GEFS");
      snapshots.push(normalizeGefsMember(
        request,
        member,
        rawMember,
        sample.gridPoint,
      ));
    }
  }
  return snapshots;
}

function aigefsPointSnapshots(
  members: readonly AigefsMember[],
  result: any,
): HybridMemberSnapshot[] {
  if (result === undefined) return [];
  return members.map((member) => {
    const raw = requiredMember(result.members, member, "AIGEFS");
    return {
      member: hgefsMember("aigefs", member),
      population: "aigefs",
      modelClass: "ai",
      cacheHit: raw.cacheHit ?? result.source?.allCacheHit ?? false,
      gridPoint: result.gridPoint,
      levels: raw.levels,
      ...(raw.fields === undefined ? {} : { fields: raw.fields }),
    };
  });
}

function gefsPointSnapshots(
  request: QueryAtmosphereRequest,
  members: readonly GefsMember[],
  result: any,
): HybridMemberSnapshot[] {
  if (result === undefined) return [];
  return members.map((member) => normalizeGefsMember(
    request,
    member,
    requiredMember(result.members, member, "GEFS"),
    result.gridPoint,
  ));
}

function normalizeGefsMember(
  request: QueryAtmosphereRequest,
  member: GefsMember,
  raw: any,
  gridPoint: { latitude: number; longitude: number },
): HybridMemberSnapshot {
  const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
  const levels = request.selection.variables === undefined
    ? []
    : memberValuesToLevels(pressureLevelsHpa, raw.pressureValues ?? []);
  for (const level of levels) {
    applyDerivedPressureValues(
      level,
      (request.selection.variables ?? []) as VariableId[],
    );
  }
  const fields = (raw.fields ?? []).map((field: any) =>
    normalizeGefsField(field.field, field.temporal, field.values));

  return {
    member: hgefsMember("gefs", member),
    population: "gefs",
    modelClass: "physics",
    cacheHit: raw.cacheHit ?? false,
    gridPoint,
    levels,
    ...(fields.length === 0 ? {} : { fields }),
  };
}

function normalizeGefsField(
  id: NonIsobaricFieldId,
  temporal: NonIsobaricFieldResult["temporal"],
  values: Record<string, number>,
): NonIsobaricFieldResult {
  const definition = NON_ISOBARIC_FIELD_CATALOG[id];
  if (definition === undefined) throw new Error(`HGEFS cannot normalize unknown GEFS field ${id}`);
  return {
    id,
    level: publicFieldLevel(definition.level),
    temporal,
    values,
  };
}

function publicFieldLevel(level: NonIsobaricLevel): NonIsobaricFieldResult["level"] {
  switch (level.type) {
    case "surface": return { type: "surface" };
    case "height_above_ground_m":
      return { type: "height_above_ground_m", heightM: level.heightM };
    case "named_layer": return { type: "named_layer", id: level.id };
    case "named_level": return { type: "named_level", id: level.id };
  }
}

function areaMemberResults(constituents: ConstituentQueryResults): HybridAreaMember[] {
  const results: HybridAreaMember[] = [];
  if (constituents.aigefs !== undefined) {
    for (const member of constituents.selectedAigefs) {
      const raw = requiredMember(constituents.aigefs.members, member, "AIGEFS");
      results.push({
        member: hgefsMember("aigefs", member),
        population: "aigefs",
        modelClass: "ai",
        cacheHit: raw.cacheHit ?? false,
        statistics: raw.statistics,
        ...(raw.distribution === undefined ? {} : { distribution: raw.distribution }),
      });
    }
  }
  if (constituents.gefs !== undefined) {
    for (const member of constituents.selectedGefs) {
      const raw = requiredMember(constituents.gefs.members, member, "GEFS");
      results.push({
        member: hgefsMember("gefs", member),
        population: "gefs",
        modelClass: "physics",
        cacheHit: raw.cacheHit ?? false,
        statistics: raw.statistics,
        distribution: {
          ...(raw.percentiles === undefined ? {} : { percentiles: raw.percentiles }),
          ...(raw.thresholdFractions === undefined
            ? {}
            : { thresholdFractions: raw.thresholdFractions }),
          ...(raw.extrema === undefined ? {} : { extrema: raw.extrema }),
        },
      });
    }
  }
  if (results.length < 2) throw new Error("HGEFS area aggregation produced fewer than two members");
  return results;
}

function profileSummaries(
  snapshots: readonly HybridMemberSnapshot[],
  quantiles: readonly number[],
) {
  const first = snapshots[0];
  if (first === undefined) throw new Error("HGEFS profile aggregation produced no members");
  const levels = first.levels;
  for (const snapshot of snapshots) {
    if (snapshot.levels.length !== levels.length) {
      throw new Error("HGEFS constituent members returned inconsistent pressure-level counts");
    }
    for (const [index, level] of snapshot.levels.entries()) {
      if (level.pressureHpa !== levels[index]?.pressureHpa) {
        throw new Error("HGEFS constituent members returned inconsistent pressure-level ordering");
      }
    }
  }

  const pressureSummaries = levels.flatMap((level, levelIndex) =>
    numericProfileKeys(level).map((field) => {
      const values = snapshots.map((snapshot) =>
        requiredNumber(
          snapshot.levels[levelIndex]?.[field],
          `HGEFS profile ${String(field)}@${level.pressureHpa}mb`,
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
    }),
  );

  const fieldSummaries = aggregateFields(
    snapshots.map((snapshot) => snapshot.fields ?? []),
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
      throw new Error("HGEFS constituent members returned inconsistent field counts");
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
        throw new Error(
          `HGEFS constituent field metadata disagree for ${field.id}; hybrid aggregation requires identical level and temporal semantics`,
        );
      }
    }
    return {
      field: field.id,
      level: field.level,
      temporal: field.temporal,
      outputs: Object.keys(field.values).map((output) => {
        const values = candidates.map((candidate) =>
          requiredNumber(candidate.values[output], `HGEFS ${field.id}.${output}`));
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
      }),
    };
  });
}

function numericProfileKeys(level: ProfileLevel): Array<Exclude<keyof ProfileLevel, "pressureHpa">> {
  return Object.keys(level)
    .filter((key) =>
      key !== "pressureHpa"
      && typeof (level as Record<string, unknown>)[key] === "number") as Array<
        Exclude<keyof ProfileLevel, "pressureHpa">
      >;
}

function hybridSelection(
  request: QueryAtmosphereRequest,
  members: readonly HgefsMember[],
  quantiles: readonly number[],
) {
  return {
    variables: request.selection.variables ?? [],
    pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
    fields: request.selection.fields ?? [],
    members,
    quantiles,
    populations: populationSelection(members),
  };
}

function hybridDiagnosticSelection(
  members: readonly HgefsMember[],
  quantiles: readonly number[],
) {
  return {
    members,
    quantiles,
    populations: populationSelection(members),
  };
}

function populationSelection(members: readonly HgefsMember[]) {
  const split = splitHgefsMembers(members);
  return [
    ...(split.gefs.length === 0 ? [] : [{
      population: "gefs" as const,
      modelClass: "physics" as const,
      selectedMemberCount: split.gefs.length,
    }]),
    ...(split.aigefs.length === 0 ? [] : [{
      population: "aigefs" as const,
      modelClass: "ai" as const,
      selectedMemberCount: split.aigefs.length,
    }]),
  ];
}

function querySource(constituents: ConstituentQueryResults) {
  return hybridSource([
    ...(constituents.aigefs === undefined ? [] : [{
      population: "aigefs" as const,
      modelClass: "ai" as const,
      selectedMemberCount: constituents.selectedAigefs.length,
      result: constituents.aigefs,
    }]),
    ...(constituents.gefs === undefined ? [] : [{
      population: "gefs" as const,
      modelClass: "physics" as const,
      selectedMemberCount: constituents.selectedGefs.length,
      result: constituents.gefs,
    }]),
  ]);
}

function hybridSource(
  constituents: readonly {
    population: HgefsPopulation;
    modelClass: "physics" | "ai";
    selectedMemberCount: number;
    result: any;
  }[],
) {
  return {
    provider: "NOAA" as const,
    access: "constituent_member_feeds" as const,
    methodology: "member_first_constituent_composition" as const,
    memberCount: constituents.reduce(
      (sum, constituent) => sum + constituent.selectedMemberCount,
      0,
    ),
    allCacheHit: constituents.every((constituent) =>
      constituentCacheHit(constituent.result)),
    constituents: constituents.map((constituent) => ({
      population: constituent.population,
      modelClass: constituent.modelClass,
      selectedMemberCount: constituent.selectedMemberCount,
      model: constituent.result.model,
      source: constituent.result.source,
    })),
  };
}

function constituentCacheHit(result: any): boolean {
  if (typeof result?.source?.allCacheHit === "boolean") return result.source.allCacheHit;
  if (typeof result?.source?.cacheHit === "boolean") return result.source.cacheHit;
  if (Array.isArray(result?.members)) {
    return result.members.every((member: any) => member.cacheHit === true);
  }
  return false;
}

function gridPointsFromSnapshots(snapshots: readonly HybridMemberSnapshot[]) {
  const values: Array<{
    population: HgefsPopulation;
    modelClass: "physics" | "ai";
    gridPoint: { latitude: number; longitude: number };
  }> = [];
  for (const population of ["gefs", "aigefs"] as const) {
    const selected = snapshots.filter((snapshot) =>
      snapshot.population === population && snapshot.gridPoint !== undefined);
    if (selected.length === 0) continue;
    const first = selected[0]!.gridPoint!;
    for (const snapshot of selected) {
      if (
        snapshot.gridPoint!.latitude !== first.latitude
        || snapshot.gridPoint!.longitude !== first.longitude
      ) {
        throw new Error(
          `HGEFS ${population} constituent members resolved to inconsistent native grid points`,
        );
      }
    }
    values.push({
      population,
      modelClass: population === "gefs" ? "physics" : "ai",
      gridPoint: first,
    });
  }
  return values;
}

function diagnosticGridPoints(aigefs: any, gefs: any) {
  return [
    ...(gefs?.gridPoint === undefined ? [] : [{
      population: "gefs" as const,
      modelClass: "physics" as const,
      gridPoint: gefs.gridPoint,
    }]),
    ...(aigefs?.gridPoint === undefined ? [] : [{
      population: "aigefs" as const,
      modelClass: "ai" as const,
      gridPoint: aigefs.gridPoint,
    }]),
  ];
}

function publicSnapshot(snapshot: HybridMemberSnapshot) {
  return {
    member: snapshot.member,
    population: snapshot.population,
    modelClass: snapshot.modelClass,
    cacheHit: snapshot.cacheHit,
    ...(snapshot.gridPoint === undefined ? {} : { gridPoint: snapshot.gridPoint }),
    levels: snapshot.levels,
    ...(snapshot.fields === undefined ? {} : { fields: snapshot.fields }),
  };
}

function diagnosticLayerMembers(
  population: HgefsPopulation,
  selected: readonly (AigefsMember | GefsMember)[],
  result: any,
) {
  if (result === undefined) return [];
  return selected.map((member) => {
    const raw = requiredMember(result.members, member, population.toUpperCase());
    return {
      member: hgefsMember(population, member),
      population,
      modelClass: population === "gefs" ? "physics" as const : "ai" as const,
      cacheHit: raw.cacheHit ?? result.source?.allCacheHit ?? false,
      layer: raw.layer,
      diagnostics: raw.diagnostics,
    };
  });
}

function diagnosticProfileMembers(
  population: HgefsPopulation,
  selected: readonly (AigefsMember | GefsMember)[],
  result: any,
) {
  if (result === undefined) return [];
  return selected.map((member) => {
    const raw = requiredMember(result.members, member, population.toUpperCase());
    return {
      member: hgefsMember(population, member),
      population,
      modelClass: population === "gefs" ? "physics" as const : "ai" as const,
      cacheHit: raw.cacheHit ?? result.source?.allCacheHit ?? false,
      levels: raw.levels,
      diagnostics: raw.diagnostics as ProfileDiagnosticResult[],
    };
  });
}

function requiredMember(
  members: readonly any[] | undefined,
  member: string,
  context: string,
): any {
  const found = members?.find((candidate) => candidate.member === member);
  if (found === undefined) {
    throw new Error(`HGEFS ${context} constituent result is missing member ${member}`);
  }
  return found;
}

function requiredAreaPercentile(entry: HybridAreaMember, percentile: number): number {
  const found = entry.distribution?.percentiles?.find((candidate) =>
    candidate.percentile === percentile);
  return requiredNumber(found?.value, `HGEFS ${entry.member} spatial percentile ${percentile}`);
}

function requiredAreaThresholdFraction(
  entry: HybridAreaMember,
  threshold: { operator: "gte" | "lte"; value: number },
): number {
  const found = entry.distribution?.thresholdFractions?.find((candidate) =>
    candidate.operator === threshold.operator
    && candidate.threshold === threshold.value);
  return requiredNumber(
    found?.fraction,
    `HGEFS ${entry.member} threshold ${threshold.operator} ${threshold.value}`,
  );
}

function requiredNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Internal HGEFS aggregation is missing ${context}`);
  }
  return value;
}

function requiredObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Internal HGEFS aggregation is missing ${context}`);
  }
  return value as Record<string, unknown>;
}

function compactPointStep(step: any) {
  return {
    validTime: step.validTime,
    forecastHour: step.forecastHour,
    constituentGridPoints: step.constituentGridPoints,
    pressureSummaries: step.pressureSummaries,
    ...(step.fieldSummaries === undefined ? {} : { fieldSummaries: step.fieldSummaries }),
    ...(step.members === undefined ? {} : { members: step.members }),
  };
}

function compactPointsStep(step: any) {
  return {
    validTime: step.validTime,
    forecastHour: step.forecastHour,
    points: step.points,
  };
}

function rangeSource(steps: readonly any[]) {
  const first = steps[0]?.source;
  if (first === undefined) throw new Error("HGEFS range source is missing");
  return {
    ...first,
    allCacheHit: steps.every((step) => step.source?.allCacheHit === true),
  };
}
