import {
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
  type IfsEnsMember,
} from "../catalog/ifs-ens.js";
import type { IfsFieldId, IfsPressureVariableId } from "../catalog/ifs.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import {
  ifsEnsDiagnosticTimeSeriesQuerySchema,
  ifsEnsDiagnosticTimeSeriesResultSchema,
  type IfsEnsDiagnosticTimeSeriesQueryInput,
  type IfsEnsDiagnosticTimeSeriesResult,
  type IfsEnsDiagnosticTimeSeriesSelection,
} from "../schema/ifs-ens-diagnostic-timeseries.js";
import type {
  IfsEnsLayerDiagnosticsQueryInput,
  IfsEnsLayerDiagnosticsResult,
  IfsEnsParcelDiagnosticsQueryInput,
  IfsEnsParcelDiagnosticsResult,
  IfsEnsProfileDiagnosticsQueryInput,
  IfsEnsProfileDiagnosticsResult,
} from "../schema/ifs-ens-diagnostics.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import { mapConcurrent } from "./concurrency.js";
import {
  IfsEnsDiagnosticsService,
} from "./ifs-ens-diagnostics.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRangeRunProvider,
} from "./ifs-ens-latest-run.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHoursInRange,
  ifsEnsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";

export const DEFAULT_IFS_ENS_DIAGNOSTIC_TIME_STEP_CONCURRENCY = 2;

export interface IfsEnsDiagnosticGetter {
  getLayerDiagnostics(query: IfsEnsLayerDiagnosticsQueryInput): Promise<IfsEnsLayerDiagnosticsResult>;
  getProfileDiagnostics(query: IfsEnsProfileDiagnosticsQueryInput): Promise<IfsEnsProfileDiagnosticsResult>;
  getParcelDiagnostics(query: IfsEnsParcelDiagnosticsQueryInput): Promise<IfsEnsParcelDiagnosticsResult>;
}

export interface IfsEnsDiagnosticTimeSeriesServiceOptions {
  diagnostics?: IfsEnsDiagnosticGetter;
  latestRunRangeProvider?: IfsEnsLatestRangeRunProvider;
  stepConcurrency?: number;
}

type TaggedResult =
  | { kind: "layer"; result: IfsEnsLayerDiagnosticsResult }
  | { kind: "profile"; result: IfsEnsProfileDiagnosticsResult }
  | { kind: "parcel"; result: IfsEnsParcelDiagnosticsResult };

type DiagnosticResult = TaggedResult["result"];

export class IfsEnsDiagnosticTimeSeriesService {
  private readonly diagnostics: IfsEnsDiagnosticGetter;
  private readonly latestRunRangeProvider: IfsEnsLatestRangeRunProvider;
  private readonly stepConcurrency: number;

  constructor(options: IfsEnsDiagnosticTimeSeriesServiceOptions = {}) {
    this.diagnostics = options.diagnostics ?? new IfsEnsDiagnosticsService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsEnsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_IFS_ENS_DIAGNOSTIC_TIME_STEP_CONCURRENCY;
  }

  async getDiagnosticTimeSeries(
    input: IfsEnsDiagnosticTimeSeriesQueryInput,
  ): Promise<IfsEnsDiagnosticTimeSeriesResult> {
    const query = ifsEnsDiagnosticTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const diagnostic = normalizeDiagnostic(query.diagnostic);
    const selectors = availabilitySelectors(diagnostic, members);

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunForRange(startTime, endTime, selectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsEnsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested IFS ENS diagnostic time range contains ${forecastHours.length} native outputs, exceeding maxSteps=${query.maxSteps}`,
      );
    }

    const taggedResults = await mapConcurrent(
      forecastHours,
      this.stepConcurrency,
      async (forecastHour): Promise<TaggedResult> => {
        const validTime = ifsEnsValidTimeForForecastHour(run, forecastHour).toISOString();
        const common = {
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime,
          members,
          quantiles,
          includeMembers: false,
        };
        switch (diagnostic.kind) {
          case "layer":
            return {
              kind: "layer",
              result: await this.diagnostics.getLayerDiagnostics({
                ...common,
                lowerPressureHpa: diagnostic.lowerPressureHpa,
                upperPressureHpa: diagnostic.upperPressureHpa,
                diagnostics: diagnostic.diagnostics,
              }),
            };
          case "profile":
            return {
              kind: "profile",
              result: await this.diagnostics.getProfileDiagnostics({
                ...common,
                pressureLevelsHpa: diagnostic.pressureLevelsHpa,
                diagnostics: diagnostic.diagnostics,
              }),
            };
          case "parcel":
            return {
              kind: "parcel",
              result: await this.diagnostics.getParcelDiagnostics({
                ...common,
                pressureLevelsHpa: diagnostic.pressureLevelsHpa,
                parcel: diagnostic.parcel,
              }),
            };
        }
      },
    );

    const first = taggedResults[0]?.result;
    if (!first) throw new Error("IFS ENS diagnostic time series produced no native forecast steps");
    const expectedRun = run.toISOString();
    for (const [index, tagged] of taggedResults.entries()) {
      const forecastHour = forecastHours[index];
      if (forecastHour === undefined) throw new Error("IFS ENS diagnostic time-series alignment failed");
      assertInvariant(tagged.result, expectedRun, run, forecastHour, first);
    }

    const firstParcel = taggedResults.find(
      (tagged): tagged is Extract<TaggedResult, { kind: "parcel" }> => tagged.kind === "parcel",
    );
    return ifsEnsDiagnosticTimeSeriesResultSchema.parse({
      model: "ifs_ens_0p25",
      run: expectedRun,
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      cadence: "ecmwf_ens_native_3h_through_f144_then_6h_on_00_12z",
      selection: { diagnostic, members, quantiles },
      ...(firstParcel ? { parcelMethodology: firstParcel.result.methodology } : {}),
      series: taggedResults.map(toCompactStep),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: taggedResults.every((tagged) => tagged.result.source.allCacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}

function normalizeDiagnostic(
  diagnostic: IfsEnsDiagnosticTimeSeriesSelection,
): IfsEnsDiagnosticTimeSeriesSelection {
  switch (diagnostic.kind) {
    case "layer":
      return { ...diagnostic, diagnostics: [...new Set(diagnostic.diagnostics)] };
    case "profile":
      return {
        ...diagnostic,
        pressureLevelsHpa: [...new Set(diagnostic.pressureLevelsHpa)].sort((a, b) => b - a),
        diagnostics: [...new Set(diagnostic.diagnostics)],
      };
    case "parcel":
      return {
        ...diagnostic,
        pressureLevelsHpa: [...new Set(diagnostic.pressureLevelsHpa)].sort((a, b) => b - a),
      };
  }
}

function availabilitySelectors(
  diagnostic: IfsEnsDiagnosticTimeSeriesSelection,
  members: readonly IfsEnsMember[],
): IfsIndexSelector[] {
  const base = (() => {
    switch (diagnostic.kind) {
      case "layer":
        return ifsIndexSelectorsForSelection({
          variables: expandLayerDiagnosticVariables(diagnostic.diagnostics) as IfsPressureVariableId[],
          pressureLevelsHpa: [diagnostic.lowerPressureHpa, diagnostic.upperPressureHpa],
        });
      case "profile":
        return ifsIndexSelectorsForSelection({
          variables: expandProfileDiagnosticVariables(diagnostic.diagnostics) as IfsPressureVariableId[],
          pressureLevelsHpa: diagnostic.pressureLevelsHpa,
        });
      case "parcel": {
        const definition = PARCEL_DIAGNOSTIC_CATALOG[diagnostic.parcel];
        return ifsIndexSelectorsForSelection({
          variables: [...definition.pressureDependencies] as IfsPressureVariableId[],
          pressureLevelsHpa: diagnostic.pressureLevelsHpa,
          fields: [...definition.fieldDependencies] as IfsFieldId[],
        });
      }
    }
  })();

  return members.flatMap((member) => {
    const number = ifsEnsMemberNumber(member);
    return base.map((selector) => ({ ...selector, number }));
  });
}

function assertInvariant(
  result: DiagnosticResult,
  expectedRun: string,
  run: Date,
  forecastHour: number,
  first: DiagnosticResult,
): void {
  const expectedValidTime = ifsEnsValidTimeForForecastHour(run, forecastHour).toISOString();
  if (result.run !== expectedRun) throw new Error("IFS ENS diagnostic time series drifted between model runs");
  if (result.validTime !== expectedValidTime || result.forecastHour !== forecastHour) {
    throw new Error("IFS ENS diagnostic time-series step returned inconsistent valid time or forecast hour");
  }
  if (
    result.gridPoint.latitude !== first.gridPoint.latitude
    || result.gridPoint.longitude !== first.gridPoint.longitude
  ) {
    throw new Error("IFS ENS diagnostic time-series steps resolved to inconsistent grid points");
  }
  if (
    result.source.product !== "ifs_0p25_enfo_ef"
    || result.source.decoder !== first.source.decoder
    || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
    || result.source.memberSemantics !== first.source.memberSemantics
  ) {
    throw new Error("IFS ENS diagnostic time-series source provenance changed within one range");
  }
}

function toCompactStep(tagged: TaggedResult) {
  switch (tagged.kind) {
    case "layer":
      return {
        kind: "layer" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        pressureLayer: tagged.result.pressureLayer,
        layerDepthGpm: tagged.result.layerDepthGpm,
        summaries: tagged.result.summaries,
        allCacheHit: tagged.result.source.allCacheHit,
      };
    case "profile":
      return {
        kind: "profile" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        sampledPressureLevelsHpa: tagged.result.sampledPressureLevelsHpa,
        summaries: tagged.result.summaries,
        allCacheHit: tagged.result.source.allCacheHit,
      };
    case "parcel":
      return {
        kind: "parcel" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        sampledPressureLevelsHpa: tagged.result.sampledPressureLevelsHpa,
        summary: tagged.result.summary,
        allCacheHit: tagged.result.source.allCacheHit,
      };
  }
}
