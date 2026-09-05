import {
  historicalPointsQuerySchema,
  historicalPointsResultSchema,
  type HistoricalPointsQueryInput,
  type HistoricalPointsResult,
} from "../schema/history-points.js";
import type { HistoricalFieldsQueryInput, HistoricalFieldsResult } from "../schema/history-fields.js";
import type { HistoricalProfileQueryInput } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import { HistoricalFieldsService } from "./history-fields.js";
import { HistoricalProfileService } from "./history.js";

const CAVEAT = "GFS model analysis; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalPointsFieldsGetter {
  getHistoricalFields(query: HistoricalFieldsQueryInput): Promise<HistoricalFieldsResult>;
}

export interface HistoricalPointsProfileGetter {
  getHistoricalProfile(query: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface HistoricalPointsServiceOptions {
  fieldsGetter?: HistoricalPointsFieldsGetter;
  profileGetter?: HistoricalPointsProfileGetter;
}

export class HistoricalPointsService {
  private readonly fieldsGetter: HistoricalPointsFieldsGetter;
  private readonly profileGetter: HistoricalPointsProfileGetter;

  constructor(options: HistoricalPointsServiceOptions = {}) {
    this.fieldsGetter = options.fieldsGetter ?? new HistoricalFieldsService();
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService();
  }

  async getPoints(input: HistoricalPointsQueryInput): Promise<HistoricalPointsResult> {
    const query = historicalPointsQuerySchema.parse(input);
    const variables = query.variables ? [...new Set(query.variables)] : undefined;
    const pressureLevelsHpa = query.pressureLevelsHpa ? [...new Set(query.pressureLevelsHpa)] : undefined;
    const fields = query.fields ? [...new Set(query.fields)] : undefined;

    const points: HistoricalPointsResult["points"] = [];
    let provider: HistoricalPointsResult["source"]["provider"] | undefined;
    let access: HistoricalPointsResult["source"]["access"] | undefined;
    // Intentionally serial. Each point may require one or more immutable upstream
    // requests and cache misses share WFG's cross-process NOAA courtesy limiter.
    for (const point of query.points) {
      if (fields) {
        const result = await this.fieldsGetter.getHistoricalFields({
          latitude: point.latitude,
          longitude: point.longitude,
          analysisTime: query.analysisTime,
          ...(variables ? { variables } : {}),
          ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
          fields,
        });
        provider ??= result.source.provider;
        access ??= result.source.access;
        points.push({
          requestedPoint: result.requestedPoint,
          gridPoint: result.gridPoint,
          ...(result.levels ? { levels: result.levels } : {}),
          fields: result.fields,
          dataset: result.source.dataset,
          cacheHit: result.source.cacheHit,
        });
      } else {
        const result = await this.profileGetter.getHistoricalProfile({
          latitude: point.latitude,
          longitude: point.longitude,
          analysisTime: query.analysisTime,
          variables: variables!,
          pressureLevelsHpa: pressureLevelsHpa!,
        });
        provider ??= result.source.provider;
        access ??= result.source.access;
        points.push({
          requestedPoint: result.requestedPoint,
          gridPoint: result.gridPoint,
          levels: result.levels,
          dataset: result.source.dataset,
          cacheHit: result.source.cacheHit,
        });
      }
    }

    return historicalPointsResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: new Date(query.analysisTime).toISOString(),
      selection: {
        ...(variables ? { variables } : {}),
        ...(pressureLevelsHpa ? { pressureLevelsHpa } : {}),
        ...(fields ? { fields } : {}),
      },
      points,
      source: {
        provider: provider!,
        access: access!,
        composition: "serial_point_queries",
      },
      caveat: CAVEAT,
    });
  }
}
