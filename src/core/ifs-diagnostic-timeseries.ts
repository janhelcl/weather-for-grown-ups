import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import type { IfsFieldId, IfsPressureVariableId } from "../catalog/ifs.js";
import {
  ifsDiagnosticTimeSeriesQuerySchema,
  ifsDiagnosticTimeSeriesResultSchema,
  type IfsDiagnosticTimeSeriesQueryInput,
  type IfsDiagnosticTimeSeriesResult,
  type IfsDiagnosticTimeSeriesSelection,
} from "../schema/ifs-diagnostic-timeseries.js";
import type {
  IfsLayerDiagnosticsQueryInput,
  IfsLayerDiagnosticsResult,
  IfsParcelDiagnosticsQueryInput,
  IfsParcelDiagnosticsResult,
  IfsProfileDiagnosticsQueryInput,
  IfsProfileDiagnosticsResult,
} from "../schema/ifs-diagnostics.js";
import type { IfsIndexSelector } from "../sources/ifs-open-data.js";
import { mapConcurrent } from "./concurrency.js";
import { IfsDiagnosticsService } from "./ifs-diagnostics.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  IfsLatestRunResolver,
  type IfsLatestRangeRunProvider,
} from "./ifs-latest-run.js";
import {
  ifsForecastHoursInRange,
  ifsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";
import { InvalidRequestError } from "../failure.js";

export const DEFAULT_IFS_DIAGNOSTIC_TIME_SERIES_CONCURRENCY = 3;

export interface IfsDiagnosticGetter {
  getLayerDiagnostics(query: IfsLayerDiagnosticsQueryInput): Promise<IfsLayerDiagnosticsResult>;
  getProfileDiagnostics(query: IfsProfileDiagnosticsQueryInput): Promise<IfsProfileDiagnosticsResult>;
  getParcelDiagnostics(query: IfsParcelDiagnosticsQueryInput): Promise<IfsParcelDiagnosticsResult>;
}

export interface IfsDiagnosticTimeSeriesServiceOptions {
  diagnostics?: IfsDiagnosticGetter;
  latestRunRangeProvider?: IfsLatestRangeRunProvider;
  concurrency?: number;
}

type TaggedResult =
  | { kind: "layer"; result: IfsLayerDiagnosticsResult }
  | { kind: "profile"; result: IfsProfileDiagnosticsResult }
  | { kind: "parcel"; result: IfsParcelDiagnosticsResult };

type IfsDiagnosticResult =
  | IfsLayerDiagnosticsResult
  | IfsProfileDiagnosticsResult
  | IfsParcelDiagnosticsResult;

export class IfsDiagnosticTimeSeriesService {
  private readonly diagnostics: IfsDiagnosticGetter;
  private readonly latestRunRangeProvider: IfsLatestRangeRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsDiagnosticTimeSeriesServiceOptions = {}) {
    this.diagnostics = options.diagnostics ?? new IfsDiagnosticsService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_IFS_DIAGNOSTIC_TIME_SERIES_CONCURRENCY;
  }

  async getDiagnosticTimeSeries(
    input: IfsDiagnosticTimeSeriesQueryInput,
  ): Promise<IfsDiagnosticTimeSeriesResult> {
    const query = ifsDiagnosticTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const selectors = availabilitySelectors(query.diagnostic);
    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunForRange(startTime, endTime, selectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested diagnostic time range contains ${forecastHours.length} native IFS outputs, exceeding maxSteps=${query.maxSteps}. Narrow the range or raise maxSteps.`,
      );
    }

    const taggedResults = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHour): Promise<TaggedResult> => {
        const validTime = ifsValidTimeForForecastHour(run, forecastHour).toISOString();
        const common = {
          latitude: query.latitude,
          longitude: query.longitude,
          run: run.toISOString(),
          validTime,
        };
        switch (query.diagnostic.kind) {
          case "layer":
            return {
              kind: "layer",
              result: await this.diagnostics.getLayerDiagnostics({
                ...common,
                lowerPressureHpa: query.diagnostic.lowerPressureHpa,
                upperPressureHpa: query.diagnostic.upperPressureHpa,
                diagnostics: query.diagnostic.diagnostics,
              }),
            };
          case "profile":
            return {
              kind: "profile",
              result: await this.diagnostics.getProfileDiagnostics({
                ...common,
                pressureLevelsHpa: query.diagnostic.pressureLevelsHpa,
                diagnostics: query.diagnostic.diagnostics,
              }),
            };
          case "parcel":
            return {
              kind: "parcel",
              result: await this.diagnostics.getParcelDiagnostics({
                ...common,
                pressureLevelsHpa: query.diagnostic.pressureLevelsHpa,
                parcel: query.diagnostic.parcel,
              }),
            };
        }
      },
    );

    const first = taggedResults[0]?.result;
    if (!first) throw new Error("No IFS diagnostic results returned for time series");
    const expectedRun = run.toISOString();
    for (const [index, tagged] of taggedResults.entries()) {
      assertInvariant(
        tagged.result,
        expectedRun,
        ifsValidTimeForForecastHour(run, forecastHours[index]!).toISOString(),
        forecastHours[index]!,
        first,
      );
    }

    return ifsDiagnosticTimeSeriesResultSchema.parse({
      model: "ifs_0p25",
      run: expectedRun,
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      source: sourceWithoutCache(first),
      diagnostic: query.diagnostic,
      series: taggedResults.map(toCompactStep),
    });
  }
}

function availabilitySelectors(
  diagnostic: IfsDiagnosticTimeSeriesSelection,
): IfsIndexSelector[] {
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
}

function assertInvariant(
  result: IfsDiagnosticResult,
  expectedRun: string,
  expectedValidTime: string,
  expectedForecastHour: number,
  first: IfsDiagnosticResult,
): void {
  if (result.run !== expectedRun) throw new Error("IFS run changed within one diagnostic time-series query");
  if (result.validTime !== expectedValidTime || result.forecastHour !== expectedForecastHour) {
    throw new Error("IFS diagnostic result time changed within one diagnostic time-series query");
  }
  if (
    result.gridPoint.latitude !== first.gridPoint.latitude
    || result.gridPoint.longitude !== first.gridPoint.longitude
  ) {
    throw new Error("IFS grid point changed within one diagnostic time-series query");
  }
  if (
    result.source.provider !== first.source.provider
    || result.source.access !== first.source.access
    || result.source.decoder !== first.source.decoder
    || result.source.product !== first.source.product
    || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
  ) {
    throw new Error("IFS source provenance changed within one diagnostic time-series query");
  }
}

function sourceWithoutCache(result: IfsDiagnosticResult) {
  const { cacheHit: _cacheHit, ...source } = result.source;
  return source;
}

function toCompactStep(tagged: TaggedResult) {
  switch (tagged.kind) {
    case "layer":
      return {
        kind: "layer" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        layer: tagged.result.layer,
        diagnostics: tagged.result.diagnostics,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "profile":
      return {
        kind: "profile" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        diagnostics: tagged.result.diagnostics,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "parcel": {
      const { parcelPath: _parcelPath, ...parcel } = tagged.result.parcel;
      return {
        kind: "parcel" as const,
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        parcel,
        cacheHit: tagged.result.source.cacheHit,
      };
    }
  }
}
