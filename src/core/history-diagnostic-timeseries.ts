import type { DiagnosticTimeSeriesSelection } from "../schema/diagnostic-time-series.js";
import {
  historicalDiagnosticTimeSeriesQuerySchema,
  historicalDiagnosticTimeSeriesResultSchema,
  type HistoricalDiagnosticTimeSeriesQueryInput,
  type HistoricalDiagnosticTimeSeriesResult,
  type HistoricalDiagnosticTimeSeriesStep,
} from "../schema/history-diagnostic-timeseries.js";
import type {
  HistoricalLayerDiagnosticsQueryInput,
  HistoricalLayerDiagnosticsResult,
  HistoricalProfileDiagnosticsQueryInput,
  HistoricalProfileDiagnosticsResult,
} from "../schema/history-diagnostics.js";
import type {
  HistoricalParcelQueryInput,
  HistoricalParcelResult,
} from "../schema/history-parcel.js";
import { NCEI_GFS_GRID4_ANALYSIS_START } from "../sources/ncei-gfs-history.js";
import { HistoricalDiagnosticsService } from "./history-diagnostics.js";
import { HistoricalParcelService } from "./history-parcel.js";
import { historicalAnalysisTimesInRange } from "./history-time-series.js";
import { InvalidRequestError } from "../failure.js";

const CAVEAT = "Diagnostics are derived from GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalLayerDiagnosticsGetter {
  getLayerDiagnostics(query: HistoricalLayerDiagnosticsQueryInput): Promise<HistoricalLayerDiagnosticsResult>;
}

export interface HistoricalProfileDiagnosticsGetter {
  getProfileDiagnostics(query: HistoricalProfileDiagnosticsQueryInput): Promise<HistoricalProfileDiagnosticsResult>;
}

export interface HistoricalParcelDiagnosticsGetter {
  getHistoricalParcel(query: HistoricalParcelQueryInput): Promise<HistoricalParcelResult>;
}

export interface HistoricalDiagnosticTimeSeriesServiceOptions {
  layerDiagnosticsGetter?: HistoricalLayerDiagnosticsGetter;
  profileDiagnosticsGetter?: HistoricalProfileDiagnosticsGetter;
  parcelDiagnosticsGetter?: HistoricalParcelDiagnosticsGetter;
  now?: () => Date;
}

type TaggedResult =
  | { kind: "layer"; result: HistoricalLayerDiagnosticsResult }
  | { kind: "profile"; result: HistoricalProfileDiagnosticsResult }
  | { kind: "parcel"; result: HistoricalParcelResult };

export class HistoricalDiagnosticTimeSeriesService {
  private readonly layerDiagnosticsGetter: HistoricalLayerDiagnosticsGetter;
  private readonly profileDiagnosticsGetter: HistoricalProfileDiagnosticsGetter;
  private readonly parcelDiagnosticsGetter: HistoricalParcelDiagnosticsGetter;
  private readonly now: () => Date;

  constructor(options: HistoricalDiagnosticTimeSeriesServiceOptions = {}) {
    const diagnostics = new HistoricalDiagnosticsService();
    this.layerDiagnosticsGetter = options.layerDiagnosticsGetter ?? diagnostics;
    this.profileDiagnosticsGetter = options.profileDiagnosticsGetter ?? diagnostics;
    this.parcelDiagnosticsGetter = options.parcelDiagnosticsGetter ?? new HistoricalParcelService();
    this.now = options.now ?? (() => new Date());
  }

  async getDiagnosticTimeSeries(
    input: HistoricalDiagnosticTimeSeriesQueryInput,
  ): Promise<HistoricalDiagnosticTimeSeriesResult> {
    const query = historicalDiagnosticTimeSeriesQuerySchema.parse(input);
    const diagnostic = normalizeSelection(query.diagnostic);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    if (startTime < NCEI_GFS_GRID4_ANALYSIS_START) {
      throw new Error(
        `NCEI GFS Grid 4 analysis history begins at ${NCEI_GFS_GRID4_ANALYSIS_START.toISOString()}`,
      );
    }
    if (endTime > this.now()) throw new Error("Historical GFS endTime must not be in the future");

    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const analysisTimes = historicalAnalysisTimesInRange(startTime, endTime, cycleHoursUtc);
    if (analysisTimes.length === 0) throw new Error("Requested range contains no selected GFS analysis cycles");
    if (analysisTimes.length > query.maxSteps) {
      throw new InvalidRequestError(
        `Requested historical diagnostic range contains ${analysisTimes.length} selected GFS analyses, exceeding maxSteps=${query.maxSteps}. Narrow the range, select fewer cycleHoursUtc, or raise maxSteps.`,
      );
    }

    // Intentionally serial: historical NCSS cache misses share the file-backed NOAA courtesy limiter.
    const tagged: TaggedResult[] = [];
    for (const analysisTime of analysisTimes) {
      tagged.push(await this.evaluate(
        query.latitude,
        query.longitude,
        analysisTime.toISOString(),
        diagnostic,
      ));
    }

    const first = tagged[0]?.result;
    if (!first) throw new Error("No historical GFS diagnostic results returned for time series");
    for (const [index, item] of tagged.entries()) {
      if (item.result.analysisTime !== analysisTimes[index]!.toISOString()) {
        throw new Error("Historical diagnostic result time changed within one time-series query");
      }
      if (
        item.result.gridPoint.latitude !== first.gridPoint.latitude
        || item.result.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("Historical GFS grid point changed within one diagnostic time-series query");
      }
      if (
        item.result.source.provider !== first.source.provider
        || item.result.source.access !== first.source.access
      ) {
        throw new Error("Historical GFS data source changed within one diagnostic time-series query");
      }
    }

    return historicalDiagnosticTimeSeriesResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      diagnostic,
      cycleHoursUtc,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
      },
      series: tagged.map(toCompactStep),
      caveat: CAVEAT,
    });
  }

  private async evaluate(
    latitude: number,
    longitude: number,
    analysisTime: string,
    diagnostic: DiagnosticTimeSeriesSelection,
  ): Promise<TaggedResult> {
    switch (diagnostic.kind) {
      case "layer":
        return {
          kind: "layer",
          result: await this.layerDiagnosticsGetter.getLayerDiagnostics({
            latitude,
            longitude,
            analysisTime,
            lowerPressureHpa: diagnostic.lowerPressureHpa,
            upperPressureHpa: diagnostic.upperPressureHpa,
            diagnostics: diagnostic.diagnostics,
          }),
        };
      case "profile":
        return {
          kind: "profile",
          result: await this.profileDiagnosticsGetter.getProfileDiagnostics({
            latitude,
            longitude,
            analysisTime,
            pressureLevelsHpa: diagnostic.pressureLevelsHpa,
            diagnostics: diagnostic.diagnostics,
          }),
        };
      case "parcel":
        return {
          kind: "parcel",
          result: await this.parcelDiagnosticsGetter.getHistoricalParcel({
            latitude,
            longitude,
            analysisTime,
            pressureLevelsHpa: diagnostic.pressureLevelsHpa,
            parcel: diagnostic.parcel,
          }),
        };
    }
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
      return {
        ...selection,
        pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)],
      };
  }
}

function toCompactStep(tagged: TaggedResult): HistoricalDiagnosticTimeSeriesStep {
  switch (tagged.kind) {
    case "layer":
      return {
        kind: "layer",
        analysisTime: tagged.result.analysisTime,
        layer: tagged.result.layer,
        diagnostics: tagged.result.diagnostics,
        dataset: tagged.result.source.dataset,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "profile":
      return {
        kind: "profile",
        analysisTime: tagged.result.analysisTime,
        diagnostics: tagged.result.diagnostics,
        dataset: tagged.result.source.dataset,
        cacheHit: tagged.result.source.cacheHit,
      };
    case "parcel": {
      const { parcelPath: _parcelPath, ...parcel } = tagged.result.parcel;
      return {
        kind: "parcel",
        analysisTime: tagged.result.analysisTime,
        parcel,
        dataset: tagged.result.source.dataset,
        cacheHit: tagged.result.source.cacheHit,
      };
    }
  }
}
