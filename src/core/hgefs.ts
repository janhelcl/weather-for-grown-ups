import type { AigefsMember } from "../catalog/aigefs.js";
import type { GefsMember, GefsProfileVariableId } from "../catalog/gefs.js";
import type { GefsPgrb2aFieldId } from "../catalog/gefs-fields.js";
import {
  hgefsPublicMember,
  splitHgefsMembers,
  type HgefsMember,
  type HgefsMemberSelection,
  type HgefsPopulation,
} from "../catalog/hgefs.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import type {
  DiagnoseAtmosphereRequest,
  QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import type { VariableId } from "../schema/query.js";
import { AigefsForecastService } from "./aigefs.js";
import { GefsBundleTimeSeriesService } from "./gefs-bundle-timeseries.js";
import { GefsLayerDiagnosticsService } from "./gefs-layer-diagnostics.js";
import { GefsMemberBundleService } from "./gefs-member-bundle.js";
import { GefsProfileDiagnosticsService } from "./gefs-profile-diagnostics.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";

const MODEL = "hgefs_0p25" as const;
const DEFAULT_QUANTILES = [0.1, 0.5, 0.9] as const;
const HGEFS_MAX_FORECAST_HOUR = 240;
const GEFS_MAX_STEPS_THROUGH_HGEFS_HORIZON = 81;
const GEFS_INTERNAL_MAX_MEMBER_SAMPLES = 20_000;

export interface HgefsForecastServiceOptions {
  aigefs?: Pick<AigefsForecastService, "query" | "diagnose">;
  gefsBundle?: Pick<GefsMemberBundleService, "getBundle">;
  gefsTimeSeries?: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  gefsLayerDiagnostics?: Pick<GefsLayerDiagnosticsService, "getLayerDiagnostics">;
  gefsProfileDiagnostics?: Pick<GefsProfileDiagnosticsService, "getProfileDiagnostics">;
}

interface HybridPressureValue {
  variable: string;
  pressureLevelHpa: number;
  value: number;
}

interface HybridFieldValue {
  field: string;
  temporal: unknown;
  values: Record<string, number>;
}

interface HybridMemberSample {
  member: HgefsMember;
  population: HgefsPopulation;
  nativeMember: string;
  cacheHit: boolean;
  gridPoint: { latitude: number; longitude: number };
  pressureValues: HybridPressureValue[];
  fields: HybridFieldValue[];
}

export class HgefsForecastService {
  private readonly aigefs: Pick<AigefsForecastService, "query" | "diagnose">;
  private readonly gefsBundle: Pick<GefsMemberBundleService, "getBundle">;
  private readonly gefsTimeSeries: Pick<GefsBundleTimeSeriesService, "getTimeSeries">;
  private readonly gefsLayerDiagnostics: Pick<GefsLayerDiagnosticsService, "getLayerDiagnostics">;
  private readonly gefsProfileDiagnostics: Pick<GefsProfileDiagnosticsService, "getProfileDiagnostics">;

  constructor(options: HgefsForecastServiceOptions = {}) {
    this.aigefs = options.aigefs ?? new AigefsForecastService();
    this.gefsBundle = options.gefsBundle ?? new GefsMemberBundleService();
    this.gefsTimeSeries = options.gefsTimeSeries ?? new GefsBundleTimeSeriesService();
    this.gefsLayerDiagnostics =
      options.gefsLayerDiagnostics ?? new GefsLayerDiagnosticsService();
    this.gefsProfileDiagnostics =
      options.gefsProfileDiagnostics ?? new GefsProfileDiagnosticsService();
  }

  async query(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "hgefs") {
      throw new Error("HGEFS service only accepts dataset=hgefs");
    }
    if (request.geometry.type !== "point") {
      throw new Error(
        "HGEFS currently exposes point and point time-range queries only; multi-point, transect and area semantics remain disabled until constituent-grid alignment is explicit",
      );
    }
    return "at" in request.time
      ? this.pointInstant(request)
      : this.pointRange(request);
  }

  async diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown> {
    if (request.dataset !== "hgefs") {
      throw new Error("HGEFS service only accepts dataset=hgefs");
    }
    if ("from" in request.time) {
      throw new Error(
        "HGEFS diagnostic time series are not exposed yet because exact hybrid aggregation requires retaining constituent member structures at every step",
      );
    }
    if (request.diagnostic.kind === "parcel") {
      throw new Error(
        "HGEFS does not expose parcel diagnostics because the AIGEFS constituent lacks the required parcel initialization state",
      );
    }
    return this.diagnosticInstant(request);
  }

  private async pointInstant(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("at" in request.time)) {
      throw new Error("Internal HGEFS routing error: expected point + instant");
    }
    const selection = splitHgefsMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);

    const ai = await this.aigefs.query(
      asAigefsQuery(request, selection.aigefs, quantiles, true),
    ) as any;
    const run = resultRun(ai, "HGEFS AIGEFS constituent query");
    assertHgefsForecastHour(ai.forecastHour);

    const physics = await this.gefsBundle.getBundle({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run,
      validTime: request.time.at,
      selection: gefsSelection(request),
      members: selection.gefs,
      quantiles,
      includeMembers: true,
    } as any) as any;

    assertConstituentAlignment(ai, physics, "HGEFS point query");
    const members = hybridPointMembers(request, selection, ai, physics);
    return {
      model: MODEL,
      run,
      validTime: ai.validTime,
      forecastHour: ai.forecastHour,
      requestedPoint: ai.requestedPoint,
      gridPoints: constituentGridPoints(ai, physics),
      selection: hybridSelection(request, selection.members, quantiles),
      ...summarizeHybridMembers(request, members, quantiles),
      ...(request.ensemble?.includeMembers === true ? { members } : {}),
      composition: hybridComposition(selection, ai, physics),
      source: hybridSource(ai, physics),
    };
  }

  private async pointRange(request: QueryAtmosphereRequest): Promise<unknown> {
    if (request.geometry.type !== "point" || !("from" in request.time)) {
      throw new Error("Internal HGEFS routing error: expected point + range");
    }
    const selection = splitHgefsMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);

    const ai = await this.aigefs.query(
      asAigefsQuery(request, selection.aigefs, quantiles, true),
    ) as any;
    const run = resultRun(ai, "HGEFS AIGEFS constituent time series");
    for (const step of requiredArray(ai.series, "HGEFS AIGEFS time series")) {
      assertHgefsForecastHour((step as any).forecastHour);
    }

    const physics = await this.gefsTimeSeries.getTimeSeries({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run,
      startTime: request.time.from,
      endTime: request.time.to,
      selection: gefsSelection(request),
      members: selection.gefs,
      quantiles,
      includeMembers: true,
      maxSteps: GEFS_MAX_STEPS_THROUGH_HGEFS_HORIZON,
      maxMemberSamples:
        request.ensemble?.maxMemberSamples ?? GEFS_INTERNAL_MAX_MEMBER_SAMPLES,
    } as any) as any;

    const physicsByTime = new Map<string, any>(
      requiredArray(physics.series, "HGEFS GEFS time series")
        .map((step: any) => [step.validTime, step]),
    );
    const aiMembers = requiredArray(ai.members, "HGEFS AIGEFS raw members");
    const series = requiredArray(ai.series, "HGEFS AIGEFS time series").map(
      (aiStep: any, stepIndex: number) => {
        const physicsStep = physicsByTime.get(aiStep.validTime);
        if (physicsStep === undefined) {
          throw new Error(
            `HGEFS constituent cadence alignment is missing GEFS valid time ${aiStep.validTime}`,
          );
        }
        if (physicsStep.forecastHour !== aiStep.forecastHour) {
          throw new Error(
            `HGEFS constituent forecast-hour mismatch at ${aiStep.validTime}`,
          );
        }
        const members = hybridRangeStepMembers(
          request,
          selection,
          ai,
          aiMembers,
          stepIndex,
          physics,
          physicsStep,
        );
        return {
          validTime: aiStep.validTime,
          forecastHour: aiStep.forecastHour,
          ...summarizeHybridMembers(request, members, quantiles),
          ...(request.ensemble?.includeMembers === true ? { members } : {}),
        };
      },
    );

    return {
      model: MODEL,
      run,
      requestedStartTime: ai.requestedStartTime,
      requestedEndTime: ai.requestedEndTime,
      stepHours: 6,
      requestedPoint: ai.requestedPoint,
      gridPoints: constituentGridPoints(ai, physics),
      selection: hybridSelection(request, selection.members, quantiles),
      series,
      composition: hybridComposition(selection, ai, physics),
      source: hybridSource(ai, physics),
    };
  }

  private async diagnosticInstant(
    request: DiagnoseAtmosphereRequest,
  ): Promise<unknown> {
    if (!("at" in request.time) || request.diagnostic.kind === "parcel") {
      throw new Error("Internal HGEFS diagnostic routing error");
    }
    const selection = splitHgefsMembers(request.ensemble?.members);
    const quantiles = requestedQuantiles(request.ensemble?.quantiles);
    const ai = await this.aigefs.diagnose(
      asAigefsDiagnostic(request, selection.aigefs, quantiles),
    ) as any;
    const run = resultRun(ai, "HGEFS AIGEFS constituent diagnostic");
    assertHgefsForecastHour(ai.forecastHour);

    if (request.diagnostic.kind === "layer") {
      const physics = await this.gefsLayerDiagnostics.getLayerDiagnostics({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        run,
        validTime: request.time.at,
        lowerPressureHpa: request.diagnostic.lowerPressureHpa,
        upperPressureHpa: request.diagnostic.upperPressureHpa,
        diagnostics: request.diagnostic.diagnostics,
        members: selection.gefs,
        quantiles,
        includeMembers: true,
      } as any) as any;
      assertConstituentAlignment(ai, physics, "HGEFS layer diagnostic");

      const hybridMembers = [
        ...requiredArray(physics.members, "HGEFS GEFS layer members").map((member: any) => ({
          member: hgefsPublicMember("gefs", member.member as GefsMember),
          population: "gefs" as const,
          nativeMember: member.member,
          cacheHit: member.cacheHit,
          layer: member.layer,
          diagnostics: member.diagnostics,
        })),
        ...requiredArray(ai.members, "HGEFS AIGEFS layer members").map((member: any) => ({
          member: hgefsPublicMember("aigefs", member.member as AigefsMember),
          population: "aigefs" as const,
          nativeMember: member.member,
          cacheHit: member.cacheHit,
          layer: member.layer,
          diagnostics: member.diagnostics,
        })),
      ];
      const aggregate = summarizeEnsembleLayerDiagnostics(
        request.diagnostic.diagnostics,
        hybridMembers,
        quantiles,
      );
      return {
        model: MODEL,
        run,
        validTime: ai.validTime,
        forecastHour: ai.forecastHour,
        requestedPoint: ai.requestedPoint,
        gridPoints: constituentGridPoints(ai, physics),
        pressureLayer: {
          lowerPressureHpa: request.diagnostic.lowerPressureHpa,
          upperPressureHpa: request.diagnostic.upperPressureHpa,
        },
        selection: {
          diagnostics: request.diagnostic.diagnostics,
          members: selection.members,
          quantiles,
        },
        layerDepthGpm: aggregate.layerDepthGpm,
        summaries: aggregate.summaries,
        ...(request.ensemble?.includeMembers === true
          ? { members: hybridMembers }
          : {}),
        composition: hybridComposition(selection, ai, physics),
        source: hybridSource(ai, physics),
      };
    }

    const physics = await this.gefsProfileDiagnostics.getProfileDiagnostics({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run,
      validTime: request.time.at,
      pressureLevelsHpa: request.diagnostic.pressureLevelsHpa,
      diagnostics: request.diagnostic.diagnostics,
      members: selection.gefs,
      quantiles,
      includeMembers: true,
    } as any) as any;
    assertConstituentAlignment(ai, physics, "HGEFS profile diagnostic");

    const hybridMembers = [
      ...requiredArray(physics.members, "HGEFS GEFS profile members").map((member: any) => ({
        member: hgefsPublicMember("gefs", member.member as GefsMember),
        population: "gefs" as const,
        nativeMember: member.member,
        cacheHit: member.cacheHit,
        levels: member.levels,
        diagnostics: member.diagnostics,
      })),
      ...requiredArray(ai.members, "HGEFS AIGEFS profile members").map((member: any) => ({
        member: hgefsPublicMember("aigefs", member.member as AigefsMember),
        population: "aigefs" as const,
        nativeMember: member.member,
        cacheHit: member.cacheHit,
        levels: member.levels,
        diagnostics: member.diagnostics,
      })),
    ];

    return {
      model: MODEL,
      run,
      validTime: ai.validTime,
      forecastHour: ai.forecastHour,
      requestedPoint: ai.requestedPoint,
      gridPoints: constituentGridPoints(ai, physics),
      sampledPressureLevelsHpa: request.diagnostic.pressureLevelsHpa,
      selection: {
        diagnostics: request.diagnostic.diagnostics,
        members: selection.members,
        quantiles,
      },
      summaries: summarizeEnsembleProfileDiagnostics(
        request.diagnostic.diagnostics,
        hybridMembers,
        quantiles,
      ),
      ...(request.ensemble?.includeMembers === true ? { members: hybridMembers } : {}),
      composition: hybridComposition(selection, ai, physics),
      source: hybridSource(ai, physics),
    };
  }
}

function asAigefsQuery(
  request: QueryAtmosphereRequest,
  members: readonly AigefsMember[],
  quantiles: readonly number[],
  includeMembers: boolean,
): QueryAtmosphereRequest {
  return {
    ...request,
    dataset: "aigefs",
    forecast: {
      ...(request.forecast ?? {}),
      run: request.forecast?.run ?? "latest",
    },
    ensemble: {
      members: [...members],
      quantiles: [...quantiles],
      includeMembers,
      ...(request.ensemble?.maxMemberSamples === undefined
        ? {}
        : { maxMemberSamples: request.ensemble.maxMemberSamples }),
    },
    source: undefined,
  } as QueryAtmosphereRequest;
}

function asAigefsDiagnostic(
  request: DiagnoseAtmosphereRequest,
  members: readonly AigefsMember[],
  quantiles: readonly number[],
): DiagnoseAtmosphereRequest {
  return {
    ...request,
    dataset: "aigefs",
    forecast: {
      ...(request.forecast ?? {}),
      run: request.forecast?.run ?? "latest",
    },
    ensemble: {
      members: [...members],
      quantiles: [...quantiles],
      includeMembers: true,
    },
    source: undefined,
  } as DiagnoseAtmosphereRequest;
}

function gefsSelection(request: QueryAtmosphereRequest) {
  return {
    variables: (request.selection.variables ?? []) as GefsProfileVariableId[],
    pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
    fields: (request.selection.fields ?? []) as GefsPgrb2aFieldId[],
  };
}

function requestedQuantiles(input: readonly number[] | undefined): number[] {
  return [...(input ?? DEFAULT_QUANTILES)].sort((left, right) => left - right);
}

function hybridPointMembers(
  request: QueryAtmosphereRequest,
  selection: HgefsMemberSelection,
  ai: any,
  physics: any,
): HybridMemberSample[] {
  return [
    ...requiredArray(physics.members, "HGEFS GEFS raw members").map((member: any) =>
      physicsMemberSample(member, physics.gridPoint)),
    ...requiredArray(ai.members, "HGEFS AIGEFS raw members").map((member: any) =>
      aiMemberSample(request, member, ai.gridPoint)),
  ].sort((left, right) =>
    selection.members.indexOf(left.member) - selection.members.indexOf(right.member));
}

function hybridRangeStepMembers(
  request: QueryAtmosphereRequest,
  selection: HgefsMemberSelection,
  ai: any,
  aiMembers: any[],
  stepIndex: number,
  physics: any,
  physicsStep: any,
): HybridMemberSample[] {
  const members = [
    ...requiredArray(physicsStep.members, "HGEFS GEFS time-step members").map((member: any) =>
      physicsMemberSample(member, physics.gridPoint)),
    ...aiMembers.map((member: any) => {
      const step = member.series?.[stepIndex];
      if (step === undefined) {
        throw new Error(
          `HGEFS AIGEFS member ${member.member} is missing time-series step ${stepIndex}`,
        );
      }
      return aiMemberSample(request, {
        member: member.member,
        cacheHit: step.cacheHit,
        levels: step.levels,
        fields: step.fields,
      }, ai.gridPoint);
    }),
  ];
  return members.sort((left, right) =>
    selection.members.indexOf(left.member) - selection.members.indexOf(right.member));
}

function physicsMemberSample(
  member: any,
  gridPoint: { latitude: number; longitude: number },
): HybridMemberSample {
  return {
    member: hgefsPublicMember("gefs", member.member as GefsMember),
    population: "gefs",
    nativeMember: member.member,
    cacheHit: member.cacheHit ?? false,
    gridPoint,
    pressureValues: requiredArray(
      member.pressureValues ?? [],
      `HGEFS GEFS pressure values for ${member.member}`,
    ) as HybridPressureValue[],
    fields: requiredArray(
      member.fields ?? [],
      `HGEFS GEFS fields for ${member.member}`,
    ) as HybridFieldValue[],
  };
}

function aiMemberSample(
  request: QueryAtmosphereRequest,
  member: any,
  gridPoint: { latitude: number; longitude: number },
): HybridMemberSample {
  const levels = requiredArray(member.levels ?? [], `HGEFS AIGEFS levels for ${member.member}`);
  const pressureValues = (request.selection.pressureLevelsHpa ?? []).flatMap(
    (pressureLevelHpa) => (request.selection.variables ?? []).map((variable) => {
      const level = levels.find((candidate: any) =>
        candidate.pressureHpa === pressureLevelHpa);
      if (level === undefined) {
        throw new Error(
          `HGEFS AIGEFS member ${member.member} is missing ${pressureLevelHpa} hPa`,
        );
      }
      const outputField = VARIABLE_CATALOG[variable as VariableId].outputs[0]?.field;
      if (outputField === undefined) {
        throw new Error(`HGEFS variable ${variable} has no scalar output`);
      }
      const value = level[outputField];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `HGEFS AIGEFS member ${member.member} is missing ${variable}@${pressureLevelHpa} hPa`,
        );
      }
      return { variable, pressureLevelHpa, value };
    }),
  );
  const fields = requiredArray(
    member.fields ?? [],
    `HGEFS AIGEFS fields for ${member.member}`,
  ).map((field: any) => ({
    field: field.id,
    temporal: field.temporal,
    values: field.values,
  }));
  return {
    member: hgefsPublicMember("aigefs", member.member as AigefsMember),
    population: "aigefs",
    nativeMember: member.member,
    cacheHit: member.cacheHit ?? false,
    gridPoint,
    pressureValues,
    fields,
  };
}

function summarizeHybridMembers(
  request: QueryAtmosphereRequest,
  members: readonly HybridMemberSample[],
  quantiles: readonly number[],
) {
  const pressureSummaries = (request.selection.pressureLevelsHpa ?? []).flatMap(
    (pressureLevelHpa) => (request.selection.variables ?? []).map((variable) => {
      const definition = VARIABLE_CATALOG[variable as VariableId];
      const output = definition.outputs[0];
      if (output === undefined) {
        throw new Error(`HGEFS variable ${variable} has no scalar output`);
      }
      const values = members.map((member) =>
        requiredPressureValue(member, variable, pressureLevelHpa));
      return {
        variable,
        pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
        distribution: summarizeNumericDistribution(values, quantiles),
      };
    }),
  );

  const fieldSummaries = (request.selection.fields ?? []).map((field) => {
    const definition = NON_ISOBARIC_FIELD_CATALOG[field as NonIsobaricFieldId];
    const memberFields = members.map((member) => requiredField(member, field));
    const temporal = memberFields[0]?.temporal;
    for (const candidate of memberFields) {
      if (JSON.stringify(candidate.temporal) !== JSON.stringify(temporal)) {
        throw new Error(
          `HGEFS constituent temporal semantics disagree for field ${field}`,
        );
      }
    }
    return {
      field,
      level: definition.level,
      temporal,
      outputs: definition.outputs.map((output) => {
        const values = memberFields.map((candidate) => {
          const value = candidate.values[output.field];
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(
              `HGEFS member field aggregation is missing ${field}.${output.field}`,
            );
          }
          return value;
        });
        return output.field === "windDirectionDeg"
          ? {
              field: output.field,
              unit: output.unit,
              aggregation: "circular_direction" as const,
              ...summarizeCircularDegrees(values),
            }
          : {
              field: output.field,
              unit: output.unit,
              aggregation: "numeric_distribution" as const,
              distribution: summarizeNumericDistribution(values, quantiles),
            };
      }),
    };
  });

  return { pressureSummaries, fieldSummaries };
}

function requiredPressureValue(
  member: HybridMemberSample,
  variable: string,
  pressureLevelHpa: number,
): number {
  const match = member.pressureValues.find((candidate) =>
    candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa);
  if (match === undefined) {
    throw new Error(
      `HGEFS hybrid aggregation is missing ${variable}@${pressureLevelHpa} hPa for ${member.member}`,
    );
  }
  return match.value;
}

function requiredField(
  member: HybridMemberSample,
  field: string,
): HybridFieldValue {
  const match = member.fields.find((candidate) => candidate.field === field);
  if (match === undefined) {
    throw new Error(
      `HGEFS hybrid aggregation is missing field ${field} for ${member.member}`,
    );
  }
  return match;
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
  };
}

function constituentGridPoints(ai: any, physics: any) {
  return {
    gefs: physics.gridPoint,
    aigefs: ai.gridPoint,
  };
}

function hybridComposition(
  selection: HgefsMemberSelection,
  ai: any,
  physics: any,
) {
  return {
    kind: "hybrid" as const,
    totalMemberCount: selection.members.length,
    populations: [
      {
        id: "gefs" as const,
        modelClass: "physics" as const,
        nativeDataset: "gefs" as const,
        nativeModel: "gefs_0p50" as const,
        memberCount: selection.gefs.length,
        members: selection.gefs.map((member) => hgefsPublicMember("gefs", member)),
        horizontalGridDegrees: physics.source?.horizontalGridDegrees ?? 0.5,
      },
      {
        id: "aigefs" as const,
        modelClass: "ai" as const,
        nativeDataset: "aigefs" as const,
        nativeModel: "aigefs_0p25" as const,
        memberCount: selection.aigefs.length,
        members: selection.aigefs.map((member) => hgefsPublicMember("aigefs", member)),
        horizontalGridDegrees: ai.source?.horizontalGridDegrees ?? 0.25,
      },
    ],
  };
}

function hybridSource(ai: any, physics: any) {
  return {
    provider: "NOAA" as const,
    access: "constituent_open_data_composition" as const,
    methodology: "member_first_gefs_plus_aigefs" as const,
    operationalProduct: {
      name: "HGEFS" as const,
      publishedGridDegrees: 0.25,
      publishedStatistics: ["mean", "spread"] as const,
    },
    constituents: {
      gefs: physics.source,
      aigefs: ai.source,
    },
    allCacheHit:
      physics.source?.allCacheHit === true
      && ai.source?.allCacheHit === true,
  };
}

function assertConstituentAlignment(ai: any, physics: any, context: string): void {
  if (resultRun(ai, context) !== resultRun(physics, context)) {
    throw new Error(`${context} resolved constituent populations to different runs`);
  }
  if (ai.validTime !== physics.validTime || ai.forecastHour !== physics.forecastHour) {
    throw new Error(
      `${context} resolved constituent populations to different valid times or forecast hours`,
    );
  }
}

function assertHgefsForecastHour(value: unknown): void {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > HGEFS_MAX_FORECAST_HOUR
  ) {
    throw new Error(
      `HGEFS supports native 6-hour forecasts from f000 through f${HGEFS_MAX_FORECAST_HOUR}`,
    );
  }
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

function requiredArray(value: unknown, context: string): any[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} is missing an expected member array`);
  }
  return value;
}
