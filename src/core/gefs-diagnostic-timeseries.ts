import { sortGefsMembers } from "../catalog/gefs.js";
import {
  gefsDiagnosticTimeSeriesQuerySchema,
  gefsDiagnosticTimeSeriesResultSchema,
  type GefsDiagnosticTimeSeriesQueryInput,
  type GefsDiagnosticTimeSeriesResult,
  type GefsDiagnosticTimeSeriesSelection,
} from "../schema/gefs-diagnostic-timeseries.js";
import type {
  GefsLayerDiagnosticsQueryInput,
  GefsLayerDiagnosticsResult,
} from "../schema/gefs-layer-diagnostics.js";
import type {
  GefsParcelDiagnosticsQueryInput,
  GefsParcelDiagnosticsResult,
} from "../schema/gefs-parcel-diagnostics.js";
import type {
  GefsProfileDiagnosticsQueryInput,
  GefsProfileDiagnosticsResult,
} from "../schema/gefs-profile-diagnostics.js";
import { mapConcurrent } from "./concurrency.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunRangeProvider,
} from "./gefs-latest-run.js";
import { GefsLayerDiagnosticsService } from "./gefs-layer-diagnostics.js";
import { GefsParcelDiagnosticsService } from "./gefs-parcel-diagnostics.js";
import { GefsProfileDiagnosticsService } from "./gefs-profile-diagnostics.js";
import {
  gefsForecastHour,
  nativeGefsValidTimesInRange,
  parseGefsRun,
} from "./gefs-time.js";

export const DEFAULT_GEFS_DIAGNOSTIC_TIME_STEP_CONCURRENCY = 2;

export interface GefsLayerDiagnosticsGetter {
  getLayerDiagnostics(query: GefsLayerDiagnosticsQueryInput): Promise<GefsLayerDiagnosticsResult>;
}

export interface GefsProfileDiagnosticsGetter {
  getProfileDiagnostics(query: GefsProfileDiagnosticsQueryInput): Promise<GefsProfileDiagnosticsResult>;
}

export interface GefsParcelDiagnosticsGetter {
  getParcelDiagnostics(query: GefsParcelDiagnosticsQueryInput): Promise<GefsParcelDiagnosticsResult>;
}

export interface GefsDiagnosticTimeSeriesServiceOptions {
  layerDiagnosticsGetter?: GefsLayerDiagnosticsGetter;
  profileDiagnosticsGetter?: GefsProfileDiagnosticsGetter;
  parcelDiagnosticsGetter?: GefsParcelDiagnosticsGetter;
  latestRunRangeProvider?: GefsLatestRunRangeProvider;
  stepConcurrency?: number;
}

type TaggedResult =
  | { kind: "layer"; result: GefsLayerDiagnosticsResult }
  | { kind: "profile"; result: GefsProfileDiagnosticsResult }
  | { kind: "parcel"; result: GefsParcelDiagnosticsResult };

export class GefsDiagnosticTimeSeriesService {
  private readonly layerDiagnosticsGetter: GefsLayerDiagnosticsGetter;
  private readonly profileDiagnosticsGetter: GefsProfileDiagnosticsGetter;
  private readonly parcelDiagnosticsGetter: GefsParcelDiagnosticsGetter;
  private readonly latestRunRangeProvider: GefsLatestRunRangeProvider;
  private readonly stepConcurrency: number;

  constructor(options: GefsDiagnosticTimeSeriesServiceOptions = {}) {
    this.layerDiagnosticsGetter = options.layerDiagnosticsGetter ?? new GefsLayerDiagnosticsService();
    this.profileDiagnosticsGetter = options.profileDiagnosticsGetter ?? new GefsProfileDiagnosticsService();
    this.parcelDiagnosticsGetter = options.parcelDiagnosticsGetter ?? new GefsParcelDiagnosticsService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_DIAGNOSTIC_TIME_STEP_CONCURRENCY;
  }

  async getDiagnosticTimeSeries(input: GefsDiagnosticTimeSeriesQueryInput): Promise<GefsDiagnosticTimeSeriesResult> {
    const query = gefsDiagnosticTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const diagnostic = normalizeSelection(query.diagnostic);
    const times = nativeGefsValidTimesInRange(startTime, endTime, query.maxSteps);

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunRange(startTime, endTime, members)
      : parseGefsRun(query.run);

    gefsForecastHour(run, startTime);
    gefsForecastHour(run, endTime);

    const results = await mapConcurrent(times, this.stepConcurrency, async (validTime): Promise<TaggedResult> => {
      const common = {
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        members,
        quantiles,
        includeMembers: false,
      };
      switch (diagnostic.kind) {
        case "layer":
          return {
            kind: "layer",
            result: await this.layerDiagnosticsGetter.getLayerDiagnostics({
              ...common,
              lowerPressureHpa: diagnostic.lowerPressureHpa,
              upperPressureHpa: diagnostic.upperPressureHpa,
              diagnostics: diagnostic.diagnostics,
            }),
          };
        case "profile":
          return {
            kind: "profile",
            result: await this.profileDiagnosticsGetter.getProfileDiagnostics({
              ...common,
              pressureLevelsHpa: diagnostic.pressureLevelsHpa,
              diagnostics: diagnostic.diagnostics,
            }),
          };
        case "parcel":
          return {
            kind: "parcel",
            result: await this.parcelDiagnosticsGetter.getParcelDiagnostics({
              ...common,
              pressureLevelsHpa: diagnostic.pressureLevelsHpa,
              parcel: diagnostic.parcel,
            }),
          };
      }
    });

    const first = results[0]?.result;
    if (!first) throw new Error("GEFS diagnostic time series produced no forecast steps");
    const expectedRun = run.toISOString();
    for (const [index, tagged] of results.entries()) {
      const expectedTime = times[index]!;
      assertInvariant(tagged.result, expectedRun, expectedTime, first.gridPoint);
    }

    const firstParcel = results.find((tagged): tagged is Extract<TaggedResult, { kind: "parcel" }> => tagged.kind === "parcel");
    return gefsDiagnosticTimeSeriesResultSchema.parse({
      model: "gefs_0p50",
      run: expectedRun,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stepHours: 3,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: { diagnostic, members, quantiles },
      ...(firstParcel ? { parcelMethodology: firstParcel.result.methodology } : {}),
      series: results.map(toCompactStep),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: results[0]!.result.source.decoder,
        product: "pgrb2a_0p50",
        allCacheHit: results.every((tagged) => tagged.result.source.allCacheHit),
      },
    });
  }
}

function normalizeSelection(selection: GefsDiagnosticTimeSeriesSelection): GefsDiagnosticTimeSeriesSelection {
  switch (selection.kind) {
    case "layer":
      return { ...selection, diagnostics: [...new Set(selection.diagnostics)] };
    case "profile":
      return {
        ...selection,
        pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)].sort((a, b) => b - a),
        diagnostics: [...new Set(selection.diagnostics)],
      };
    case "parcel":
      return {
        ...selection,
        pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)].sort((a, b) => b - a),
      };
  }
}

function assertInvariant(
  result: GefsLayerDiagnosticsResult | GefsProfileDiagnosticsResult | GefsParcelDiagnosticsResult,
  expectedRun: string,
  expectedValidTime: Date,
  expectedGridPoint: { latitude: number; longitude: number },
): void {
  const expectedValidIso = expectedValidTime.toISOString();
  const expectedForecastHour = gefsForecastHour(new Date(expectedRun), expectedValidTime);
  if (result.run !== expectedRun) throw new Error("GEFS diagnostic time series drifted between model runs");
  if (result.validTime !== expectedValidIso || result.forecastHour !== expectedForecastHour) {
    throw new Error("GEFS diagnostic time-series step returned inconsistent valid time or forecast hour");
  }
  if (
    result.gridPoint.latitude !== expectedGridPoint.latitude ||
    result.gridPoint.longitude !== expectedGridPoint.longitude
  ) {
    throw new Error("GEFS diagnostic time-series steps resolved to inconsistent grid points");
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
