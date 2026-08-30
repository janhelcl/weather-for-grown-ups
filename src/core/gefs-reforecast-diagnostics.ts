import type {
  GefsReforecastPressureVariableId,
} from "../catalog/gefs-reforecast.js";
import {
  expandLayerDiagnosticVariables,
} from "../catalog/layer-diagnostics.js";
import {
  expandProfileDiagnosticVariables,
} from "../catalog/profile-diagnostics.js";
import {
  gefsReforecastDiagnosticTimeSeriesQuerySchema,
  gefsReforecastDiagnosticTimeSeriesResultSchema,
  gefsReforecastLayerDiagnosticsQuerySchema,
  gefsReforecastLayerDiagnosticsResultSchema,
  gefsReforecastProfileDiagnosticsQuerySchema,
  gefsReforecastProfileDiagnosticsResultSchema,
  type GefsReforecastDiagnosticTimeSeriesQueryInput,
  type GefsReforecastDiagnosticTimeSeriesResult,
  type GefsReforecastLayerDiagnosticsQueryInput,
  type GefsReforecastLayerDiagnosticsResult,
  type GefsReforecastProfileDiagnosticsQueryInput,
  type GefsReforecastProfileDiagnosticsResult,
} from "../schema/gefs-reforecast-diagnostics.js";
import type {
  GefsReforecastProfileQueryInput,
  GefsReforecastProfileResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  nativeGefsReforecastValidTimesInRange,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import { GefsReforecastProfileService } from "./gefs-reforecast-profile.js";
import {
  deriveLayerDiagnosticsFromLevels,
  deriveProfileDiagnosticsFromLevels,
} from "./pressure-diagnostics.js";
import type { ProfileDiagnosticResult, ProfileLevel } from "./types.js";
import { sortGefsMembers } from "../catalog/gefs.js";
import type { GefsReforecastMember } from "../catalog/gefs-reforecast.js";

export interface GefsReforecastDiagnosticProfileGetter {
  getProfile(query: GefsReforecastProfileQueryInput): Promise<GefsReforecastProfileResult>;
}

export interface GefsReforecastLayerDiagnosticsServiceOptions {
  profileGetter?: GefsReforecastDiagnosticProfileGetter;
}

export class GefsReforecastLayerDiagnosticsService {
  private readonly profileGetter: GefsReforecastDiagnosticProfileGetter;

  constructor(options: GefsReforecastLayerDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new GefsReforecastProfileService();
  }

  async getLayerDiagnostics(
    input: GefsReforecastLayerDiagnosticsQueryInput,
  ): Promise<GefsReforecastLayerDiagnosticsResult> {
    const query = gefsReforecastLayerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const variables = expandLayerDiagnosticVariables(diagnostics) as GefsReforecastPressureVariableId[];
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa: [query.lowerPressureHpa, query.upperPressureHpa],
      members,
      quantiles,
      includeMembers: true,
    });
    const memberProfiles = requiredMemberProfiles(profile);
    const cacheByMember = new Map(
      (profile.members ?? []).map((sample) => [sample.member, sample.cacheHit]),
    );
    const derivedMembers = memberProfiles.map((memberProfile) => {
      const derived = deriveLayerDiagnosticsFromLevels(
        memberProfile.levels,
        query.lowerPressureHpa,
        query.upperPressureHpa,
        diagnostics,
      );
      return {
        member: memberProfile.member,
        cacheHit: cacheByMember.get(memberProfile.member) ?? false,
        ...derived,
      };
    });
    const aggregate = summarizeEnsembleLayerDiagnostics(
      diagnostics,
      derivedMembers,
      profile.selection.quantiles,
    );

    return gefsReforecastLayerDiagnosticsResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      pressureLayer: {
        lowerPressureHpa: query.lowerPressureHpa,
        upperPressureHpa: query.upperPressureHpa,
      },
      selection: {
        diagnostics,
        members: profile.selection.members,
        quantiles: profile.selection.quantiles,
      },
      layerDepthGpm: aggregate.layerDepthGpm,
      summaries: aggregate.summaries,
      ...(query.includeMembers
        ? {
            members: derivedMembers.map((member) => ({
              member: member.member,
              cacheHit: member.cacheHit,
              layer: member.layer,
              diagnostics: member.diagnostics,
            })),
          }
        : {}),
      source: profile.source,
    });
  }
}

export interface GefsReforecastProfileDiagnosticsServiceOptions {
  profileGetter?: GefsReforecastDiagnosticProfileGetter;
}

interface DerivedProfileMember {
  member: GefsReforecastMember;
  cacheHit: boolean;
  levels: ProfileLevel[];
  diagnostics: ProfileDiagnosticResult[];
}

export class GefsReforecastProfileDiagnosticsService {
  private readonly profileGetter: GefsReforecastDiagnosticProfileGetter;

  constructor(options: GefsReforecastProfileDiagnosticsServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new GefsReforecastProfileService();
  }

  async getProfileDiagnostics(
    input: GefsReforecastProfileDiagnosticsQueryInput,
  ): Promise<GefsReforecastProfileDiagnosticsResult> {
    const query = gefsReforecastProfileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)];
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const variables = expandProfileDiagnosticVariables(diagnostics) as GefsReforecastPressureVariableId[];
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);

    const profile = await this.profileGetter.getProfile({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
      members,
      quantiles,
      includeMembers: true,
    });
    const cacheByMember = new Map(
      (profile.members ?? []).map((sample) => [sample.member, sample.cacheHit]),
    );
    const derivedMembers: DerivedProfileMember[] = requiredMemberProfiles(profile)
      .map((memberProfile) => ({
        member: memberProfile.member,
        cacheHit: cacheByMember.get(memberProfile.member) ?? false,
        levels: memberProfile.levels,
        diagnostics: deriveProfileDiagnosticsFromLevels(
          memberProfile.levels,
          diagnostics,
        ),
      }));

    return gefsReforecastProfileDiagnosticsResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: profile.run,
      validTime: profile.validTime,
      forecastHour: profile.forecastHour,
      requestedPoint: profile.requestedPoint,
      gridPoint: profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: {
        diagnostics,
        members: profile.selection.members,
        quantiles: profile.selection.quantiles,
      },
      summaries: summarizeEnsembleProfileDiagnostics(
        diagnostics,
        derivedMembers,
        profile.selection.quantiles,
      ),
      ...(query.includeMembers
        ? {
            members: derivedMembers.map((member) => ({
              member: member.member,
              cacheHit: member.cacheHit,
              levels: member.levels,
              diagnostics: member.diagnostics,
            })),
          }
        : {}),
      source: profile.source,
    });
  }
}

export const DEFAULT_GEFS_REFORECAST_DIAGNOSTIC_STEP_CONCURRENCY = 2;

export interface GefsReforecastDiagnosticTimeSeriesServiceOptions {
  layerGetter?: Pick<GefsReforecastLayerDiagnosticsService, "getLayerDiagnostics">;
  profileGetter?: Pick<GefsReforecastProfileDiagnosticsService, "getProfileDiagnostics">;
  stepConcurrency?: number;
}

type TaggedDiagnostic =
  | { kind: "layer"; result: GefsReforecastLayerDiagnosticsResult }
  | { kind: "profile"; result: GefsReforecastProfileDiagnosticsResult };

export class GefsReforecastDiagnosticTimeSeriesService {
  private readonly layerGetter: Pick<
    GefsReforecastLayerDiagnosticsService,
    "getLayerDiagnostics"
  >;
  private readonly profileGetter: Pick<
    GefsReforecastProfileDiagnosticsService,
    "getProfileDiagnostics"
  >;
  private readonly stepConcurrency: number;

  constructor(options: GefsReforecastDiagnosticTimeSeriesServiceOptions = {}) {
    this.layerGetter = options.layerGetter ?? new GefsReforecastLayerDiagnosticsService();
    this.profileGetter =
      options.profileGetter ?? new GefsReforecastProfileDiagnosticsService();
    this.stepConcurrency =
      options.stepConcurrency ?? DEFAULT_GEFS_REFORECAST_DIAGNOSTIC_STEP_CONCURRENCY;
  }

  async getDiagnosticTimeSeries(
    input: GefsReforecastDiagnosticTimeSeriesQueryInput,
  ): Promise<GefsReforecastDiagnosticTimeSeriesResult> {
    const query = gefsReforecastDiagnosticTimeSeriesQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      startTime,
      endTime,
      query.maxSteps,
    );
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const diagnostic = normalizeDiagnostic(query.diagnostic);

    const results = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime): Promise<TaggedDiagnostic> => {
        const common = {
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime: validTime.toISOString(),
          members,
          quantiles,
          includeMembers: false,
        };
        if (diagnostic.kind === "layer") {
          return {
            kind: "layer",
            result: await this.layerGetter.getLayerDiagnostics({
              ...common,
              lowerPressureHpa: diagnostic.lowerPressureHpa,
              upperPressureHpa: diagnostic.upperPressureHpa,
              diagnostics: diagnostic.diagnostics,
            }),
          };
        }
        return {
          kind: "profile",
          result: await this.profileGetter.getProfileDiagnostics({
            ...common,
            pressureLevelsHpa: diagnostic.pressureLevelsHpa,
            diagnostics: diagnostic.diagnostics,
          }),
        };
      },
    );

    const first = results[0]?.result;
    if (!first) {
      throw new Error("GEFSv12 reforecast diagnostic time series produced no forecast steps");
    }
    for (const [index, tagged] of results.entries()) {
      const expectedTime = times[index];
      if (!expectedTime) {
        throw new Error("GEFSv12 reforecast diagnostic time alignment failed");
      }
      assertDiagnosticStep(
        tagged.result,
        run,
        expectedTime,
        first.source.decoder,
      );
    }

    return gefsReforecastDiagnosticTimeSeriesResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      selection: { diagnostic, members, quantiles },
      series: results.map((tagged) => {
        if (tagged.kind === "layer") {
          return {
            kind: "layer" as const,
            validTime: tagged.result.validTime,
            forecastHour: tagged.result.forecastHour,
            gridPoint: tagged.result.gridPoint,
            pressureLayer: tagged.result.pressureLayer,
            layerDepthGpm: tagged.result.layerDepthGpm,
            summaries: tagged.result.summaries,
            source: stepSource(tagged.result),
          };
        }
        return {
          kind: "profile" as const,
          validTime: tagged.result.validTime,
          forecastHour: tagged.result.forecastHour,
          gridPoint: tagged.result.gridPoint,
          sampledPressureLevelsHpa: tagged.result.sampledPressureLevelsHpa,
          summaries: tagged.result.summaries,
          source: stepSource(tagged.result),
        };
      }),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: first.source.decoder,
        archiveType: "reforecast",
        dataset: "GEFSv12/reforecast",
        nativeCadence: [
          { fromForecastHour: 3, throughForecastHour: 240, stepHours: 3 },
          { fromForecastHour: 246, throughForecastHour: 384, stepHours: 6 },
        ],
        allCacheHit: results.every((tagged) => tagged.result.source.allCacheHit),
      },
    });
  }
}

function requiredMemberProfiles(profile: GefsReforecastProfileResult): Array<{
  member: GefsReforecastMember;
  levels: ProfileLevel[];
}> {
  if (!profile.members) {
    throw new Error(
      "GEFSv12 reforecast diagnostic profile adaptation requires includeMembers=true",
    );
  }
  return profile.members.map((member) => ({
    member: member.member,
    levels: memberValuesToLevels(
      profile.selection.pressureLevelsHpa,
      member.values,
    ),
  }));
}

function memberValuesToLevels(
  pressureLevelsHpa: readonly number[],
  values: readonly {
    variable: GefsReforecastPressureVariableId;
    pressureLevelHpa: number;
    value: number;
  }[],
): ProfileLevel[] {
  return pressureLevelsHpa.map((pressureHpa) => {
    const level: ProfileLevel = { pressureHpa };
    for (const value of values) {
      if (value.pressureLevelHpa !== pressureHpa) continue;
      switch (value.variable) {
        case "temperature":
          level.temperatureC = value.value;
          break;
        case "u_wind":
          level.uWindMs = value.value;
          break;
        case "v_wind":
          level.vWindMs = value.value;
          break;
        case "geopotential_height":
          level.geopotentialHeightGpm = value.value;
          break;
        case "vertical_velocity":
          level.verticalVelocityPaS = value.value;
          break;
        case "specific_humidity":
          level.specificHumidityKgKg = value.value;
          break;
      }
    }
    return level;
  });
}

function normalizeDiagnostic(
  diagnostic: ReturnType<
    typeof gefsReforecastDiagnosticTimeSeriesQuerySchema.parse
  >["diagnostic"],
) {
  if (diagnostic.kind === "layer") {
    return {
      ...diagnostic,
      diagnostics: [...new Set(diagnostic.diagnostics)],
    };
  }
  return {
    ...diagnostic,
    pressureLevelsHpa: [...new Set(diagnostic.pressureLevelsHpa)]
      .sort((a, b) => b - a),
    diagnostics: [...new Set(diagnostic.diagnostics)],
  };
}

function assertDiagnosticStep(
  result: GefsReforecastLayerDiagnosticsResult | GefsReforecastProfileDiagnosticsResult,
  run: Date,
  validTime: Date,
  decoder: "gribberish" | "wgrib2",
): void {
  if (
    result.run !== run.toISOString()
    || result.validTime !== validTime.toISOString()
    || result.forecastHour !== gefsReforecastForecastHour(run, validTime)
  ) {
    throw new Error(
      "GEFSv12 reforecast diagnostic range changed run or valid-time semantics",
    );
  }
  if (result.source.decoder !== decoder) {
    throw new Error(
      "GEFSv12 reforecast diagnostic range changed decoder between steps",
    );
  }
}

function stepSource(
  result: GefsReforecastLayerDiagnosticsResult | GefsReforecastProfileDiagnosticsResult,
) {
  return {
    leadBlock: result.source.leadBlock,
    horizontalGridDegrees: result.source.horizontalGridDegrees,
    profileGridPolicy: result.source.profileGridPolicy,
    allCacheHit: result.source.allCacheHit,
  };
}
