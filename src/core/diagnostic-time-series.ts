import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import type {
  DiagnosticTimeSeriesQueryInput,
  DiagnosticTimeSeriesSelection,
} from "../schema/diagnostic-time-series.js";
import { diagnosticTimeSeriesQuerySchema } from "../schema/diagnostic-time-series.js";
import type {
  DiagnosticTimeSeriesResult,
  DiagnosticTimeSeriesStep,
} from "../schema/diagnostic-time-series-result.js";
import type {
  LayerDiagnosticsQueryInput,
  ParcelDiagnosticsQueryInput,
  ProfileDiagnosticsQueryInput,
} from "../schema/query.js";
import type { ForecastAvailabilitySelection } from "../sources/gfs-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  nativeForecastHoursInRange,
  parseGfsRun,
  validTimeForForecastHour,
} from "./forecast-hour.js";
import { LayerDiagnosticsService } from "./layer-diagnostics.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import { ParcelDiagnosticsService } from "./parcel-diagnostics.js";
import { ProfileDiagnosticsService } from "./profile-diagnostics.js";
import type {
  GridPoint,
  LayerDiagnosticsResult,
  ParcelDiagnosticsResult,
  ProfileDiagnosticsResult,
  SourceProvenance,
} from "./types.js";

export const DEFAULT_DIAGNOSTIC_TIME_SERIES_CONCURRENCY = 4;

export interface LayerDiagnosticsGetter {
  getLayerDiagnostics(query: LayerDiagnosticsQueryInput): Promise<LayerDiagnosticsResult>;
}

export interface ProfileDiagnosticsGetter {
  getProfileDiagnostics(query: ProfileDiagnosticsQueryInput): Promise<ProfileDiagnosticsResult>;
}

export interface ParcelDiagnosticsGetter {
  getParcelDiagnostics(query: ParcelDiagnosticsQueryInput): Promise<ParcelDiagnosticsResult>;
}

export interface DiagnosticTimeSeriesServiceOptions {
  layerDiagnosticsGetter?: LayerDiagnosticsGetter;
  profileDiagnosticsGetter?: ProfileDiagnosticsGetter;
  parcelDiagnosticsGetter?: ParcelDiagnosticsGetter;
  latestRunProvider?: LatestRunProvider;
  concurrency?: number;
}

type TaggedDiagnosticResult =
  | { kind: "layer"; result: LayerDiagnosticsResult }
  | { kind: "profile"; result: ProfileDiagnosticsResult }
  | { kind: "parcel"; result: ParcelDiagnosticsResult };

export class DiagnosticTimeSeriesService {
  private readonly layerDiagnosticsGetter: LayerDiagnosticsGetter;
  private readonly profileDiagnosticsGetter: ProfileDiagnosticsGetter;
  private readonly parcelDiagnosticsGetter: ParcelDiagnosticsGetter;
  private readonly latestRunProvider: LatestRunProvider;
  private readonly concurrency: number;

  constructor(options: DiagnosticTimeSeriesServiceOptions = {}) {
    this.layerDiagnosticsGetter = options.layerDiagnosticsGetter ?? new LayerDiagnosticsService();
    this.profileDiagnosticsGetter = options.profileDiagnosticsGetter ?? new ProfileDiagnosticsService();
    this.parcelDiagnosticsGetter = options.parcelDiagnosticsGetter ?? new ParcelDiagnosticsService();
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_DIAGNOSTIC_TIME_SERIES_CONCURRENCY;
  }

  async getDiagnosticTimeSeries(input: DiagnosticTimeSeriesQueryInput): Promise<DiagnosticTimeSeriesResult> {
    const query = diagnosticTimeSeriesQuerySchema.parse(input);
    const diagnostic = normalizeSelection(query.diagnostic);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "time_range",
          startTime,
          endTime,
          selection: availabilitySelection(diagnostic),
        }, query.grid)
      : query.run === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun(undefined, query.grid)
        : parseGfsRun(query.run);
    const forecastHours = nativeForecastHoursInRange(run, startTime, endTime, query.grid);

    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested diagnostic time range contains ${forecastHours.length} native GFS outputs, exceeding maxSteps=${query.maxSteps}. Narrow the range or raise maxSteps.`,
      );
    }

    const taggedResults = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHourValue): Promise<TaggedDiagnosticResult> => {
        const validTime = validTimeForForecastHour(run, forecastHourValue).toISOString();
        switch (diagnostic.kind) {
          case "layer":
            return {
              kind: "layer",
              result: await this.layerDiagnosticsGetter.getLayerDiagnostics({
                latitude: query.latitude,
                longitude: query.longitude,
                run: run.toISOString(),
                grid: query.grid,
                validTime,
                lowerPressureHpa: diagnostic.lowerPressureHpa,
                upperPressureHpa: diagnostic.upperPressureHpa,
                diagnostics: diagnostic.diagnostics,
                source: query.source,
              }),
            };
          case "profile":
            return {
              kind: "profile",
              result: await this.profileDiagnosticsGetter.getProfileDiagnostics({
                latitude: query.latitude,
                longitude: query.longitude,
                run: run.toISOString(),
                grid: query.grid,
                validTime,
                pressureLevelsHpa: diagnostic.pressureLevelsHpa,
                diagnostics: diagnostic.diagnostics,
                source: query.source,
              }),
            };
          case "parcel":
            return {
              kind: "parcel",
              result: await this.parcelDiagnosticsGetter.getParcelDiagnostics({
                latitude: query.latitude,
                longitude: query.longitude,
                run: run.toISOString(),
                grid: query.grid,
                validTime,
                pressureLevelsHpa: diagnostic.pressureLevelsHpa,
                parcel: diagnostic.parcel,
                source: query.source,
              }),
            };
        }
      },
    );

    const first = taggedResults[0]?.result;
    if (!first) throw new Error("No GFS diagnostic results returned for time series");
    const expectedRun = run.toISOString();
    for (const [index, tagged] of taggedResults.entries()) {
      assertResultInvariant(
        tagged.result,
        expectedRun,
        validTimeForForecastHour(run, forecastHours[index]!).toISOString(),
        forecastHours[index]!,
        first.gridPoint,
        first.source,
      );
    }

    return {
      model: first.model,
      run: expectedRun,
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      source: {
        provider: first.source.provider,
        access: first.source.access,
        decoder: first.source.decoder,
      },
      diagnostic,
      series: taggedResults.map(toCompactStep),
    };
  }
}

function normalizeSelection(selection: DiagnosticTimeSeriesSelection): DiagnosticTimeSeriesSelection {
  switch (selection.kind) {
    case "layer":
      return { ...selection, diagnostics: [...new Set(selection.diagnostics)] };
    case "profile":
      return {
        ...selection,
        pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)],
        diagnostics: [...new Set(selection.diagnostics)],
      };
    case "parcel":
      return { ...selection, pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)] };
  }
}

function availabilitySelection(selection: DiagnosticTimeSeriesSelection): ForecastAvailabilitySelection {
  switch (selection.kind) {
    case "layer": {
      const variables = expandRequestedVariables(expandLayerDiagnosticVariables(selection.diagnostics));
      return {
        variableCodes: variables.map((variable) => variable.gfsCode),
        pressureLevelsHpa: [selection.lowerPressureHpa, selection.upperPressureHpa],
        fields: [],
      };
    }
    case "profile": {
      const variables = expandRequestedVariables(expandProfileDiagnosticVariables(selection.diagnostics));
      return {
        variableCodes: variables.map((variable) => variable.gfsCode),
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: [],
      };
    }
    case "parcel": {
      const definition = PARCEL_DIAGNOSTIC_CATALOG[selection.parcel];
      const variables = expandRequestedVariables([...definition.pressureDependencies]);
      return {
        variableCodes: variables.map((variable) => variable.gfsCode),
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: expandRequestedFields(definition.fieldDependencies),
      };
    }
  }
}

function assertResultInvariant(
  result: LayerDiagnosticsResult | ProfileDiagnosticsResult | ParcelDiagnosticsResult,
  expectedRun: string,
  expectedValidTime: string,
  expectedForecastHour: number,
  expectedGridPoint: GridPoint,
  expectedSource: SourceProvenance,
): void {
  if (result.run !== expectedRun) throw new Error("GFS run changed within one diagnostic time-series query");
  if (result.validTime !== expectedValidTime || result.forecastHour !== expectedForecastHour) {
    throw new Error("Diagnostic result time changed within one diagnostic time-series query");
  }
  if (
    result.gridPoint.latitude !== expectedGridPoint.latitude ||
    result.gridPoint.longitude !== expectedGridPoint.longitude
  ) {
    throw new Error("GFS grid point changed within one diagnostic time-series query");
  }
  if (
    result.source.provider !== expectedSource.provider ||
    result.source.access !== expectedSource.access ||
    result.source.decoder !== expectedSource.decoder
  ) {
    throw new Error("Data source changed within one diagnostic time-series query");
  }
}

function toCompactStep(tagged: TaggedDiagnosticResult): DiagnosticTimeSeriesStep {
  switch (tagged.kind) {
    case "layer":
      return {
        kind: "layer",
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        layer: tagged.result.layer,
        diagnostics: tagged.result.diagnostics,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "profile":
      return {
        kind: "profile",
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        diagnostics: tagged.result.diagnostics,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "parcel": {
      const { parcelPath: _parcelPath, ...parcel } = tagged.result.parcel;
      return {
        kind: "parcel",
        validTime: tagged.result.validTime,
        forecastHour: tagged.result.forecastHour,
        parcel,
        cacheHit: tagged.result.source.cacheHit,
      };
    }
  }
}
