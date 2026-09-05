import type {
  HistoricalAnalysisAccess,
  HistoricalAnalysisAreaRequest,
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisProvider,
  HistoricalAnalysisRequest,
  HistoricalAnalysisSource,
} from "./gfs-analysis.js";
import {
  historicalAnalysisSelector,
  ncssNamesForHistoricalAnalysisVariables,
  parseHistoricalNcssAreaCsv,
  parseHistoricalNcssPointCsv,
} from "./gfs-analysis-grib.js";
import type {
  ArchivedGfsForecastAreaDataSource,
  ArchivedGfsForecastDataSource,
} from "./ncei-gfs-forecast-history.js";

export interface ArchivedGfsForecastAnalysisAdapterOptions {
  source: ArchivedGfsForecastDataSource;
  areaSource?: ArchivedGfsForecastAreaDataSource;
  runTime: Date;
  forecastHour: number;
  validTime: Date;
  provider: HistoricalAnalysisProvider;
  access: HistoricalAnalysisAccess;
}

/**
 * Adapt one archived GFS forecast step into the typed historical-analysis
 * normalization contract. NCSS column names and CSV remain source concerns;
 * profile/field/area services consume canonical WFG IDs and typed values.
 */
export class ArchivedGfsForecastAnalysisAdapter implements HistoricalAnalysisSource {
  constructor(private readonly options: ArchivedGfsForecastAnalysisAdapterOptions) {}

  async fetch(request: HistoricalAnalysisRequest): Promise<HistoricalAnalysisPointResponse> {
    this.assertValidTime(request.analysisTime);
    const response = await this.options.source.fetch({
      runTime: this.options.runTime,
      forecastHour: this.options.forecastHour,
      latitude: request.latitude,
      longitude: request.longitude,
      variables: ncssNamesForHistoricalAnalysisVariables(request.variables),
    });
    return {
      rows: parseHistoricalNcssPointCsv(response.csv, request.variables, {
        latitude: request.latitude,
        longitude: request.longitude,
      }),
      dataset: response.dataset,
      cacheHit: response.cacheHit,
      provider: this.options.provider,
      access: this.options.access,
    };
  }

  async fetchArea(request: HistoricalAnalysisAreaRequest): Promise<HistoricalAnalysisAreaResponse> {
    this.assertValidTime(request.analysisTime);
    const areaSource = this.options.areaSource;
    if (areaSource === undefined) {
      throw new Error("Archived GFS analysis adapter was not configured for area queries");
    }
    const response = await areaSource.fetchArea({
      runTime: this.options.runTime,
      forecastHour: this.options.forecastHour,
      westLongitude: request.westLongitude,
      eastLongitude: request.eastLongitude,
      southLatitude: request.southLatitude,
      northLatitude: request.northLatitude,
      variables: [historicalAnalysisSelector(request.variable).ncssName],
      ...(request.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: request.verticalCoordinate }),
      ...(request.horizontalStride === undefined
        ? {}
        : { horizontalStride: request.horizontalStride }),
    });
    return {
      variable: request.variable,
      points: parseHistoricalNcssAreaCsv(
        response.csv,
        request.variable,
        request.verticalCoordinate,
      ),
      ...(request.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: request.verticalCoordinate }),
      dataset: response.dataset,
      cacheHit: response.cacheHit,
      provider: this.options.provider,
      access: this.options.access,
    };
  }

  private assertValidTime(analysisTime: Date): void {
    if (analysisTime.getTime() !== this.options.validTime.getTime()) {
      throw new Error(
        `Archived GFS analysis adapter expected validTime ${this.options.validTime.toISOString()}, received ${analysisTime.toISOString()}`,
      );
    }
  }
}
