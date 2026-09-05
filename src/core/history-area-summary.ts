import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { CachedGfsAnalysisFileStore, CachedGfsAnalysisSource } from "../cache/historical-gfs-cache.js";
import { RoutedGfsAnalysisSource } from "../sources/gfs-analysis-routed.js";
import type { HistoricalAnalysisAreaDataSource } from "../sources/gfs-analysis.js";
import {
  HISTORICAL_AREA_FIELD_CATALOG,
  HISTORICAL_AREA_PRESSURE_CATALOG,
  type HistoricalAreaSourceDefinition,
} from "../catalog/history-area.js";
import type { GridValuePoint } from "../grib/wgrib2-grid.js";
import {
  historicalAreaFieldLevel,
  historicalAreaSummaryQuerySchema,
  historicalAreaSummaryResultSchema,
  type HistoricalAreaSummaryQueryInput,
  type HistoricalAreaSummaryResult,
} from "../schema/history-area-summary.js";
import { isoDateTimeSchema } from "../schema/query.js";
import { NCEI_GFS_GRID4_ANALYSIS_START } from "../sources/ncei-gfs-history.js";
import { computeAreaDistribution } from "./area-distribution.js";
import { InvalidRequestError } from "../failure.js";

const GRID_SPACING_DEG = 0.5;
const CAVEAT = "GFS model analysis area statistics; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalAreaSummaryServiceOptions {
  cacheDir?: string;
  accessPolicy?: UpstreamAccessPolicy;
  source?: HistoricalAnalysisAreaDataSource;
  now?: () => Date;
  allowNonAnalysisCycle?: boolean;
  minimumTime?: Date;
  gridSpacingDegrees?: number;
}

export class HistoricalAreaSummaryService {
  private readonly source: HistoricalAnalysisAreaDataSource;
  private readonly now: () => Date;
  private readonly allowNonAnalysisCycle: boolean;
  private readonly minimumTime: Date;
  private readonly gridSpacingDegrees: number;

  constructor(options: HistoricalAreaSummaryServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const accessPolicy = options.accessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    const awsAccessPolicy = new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.noaaAws);
    this.source = options.source ?? new CachedGfsAnalysisSource(
      join(cacheDir, "gfs-analysis"),
      new RoutedGfsAnalysisSource({
        nceiAccessPolicy: accessPolicy,
        awsAccessPolicy,
        fileStore: new CachedGfsAnalysisFileStore(join(cacheDir, "gfs-analysis-fileserver")),
      }),
    );
    this.now = options.now ?? (() => new Date());
    this.allowNonAnalysisCycle = options.allowNonAnalysisCycle ?? false;
    this.minimumTime = options.minimumTime ?? NCEI_GFS_GRID4_ANALYSIS_START;
    this.gridSpacingDegrees = options.gridSpacingDegrees ?? GRID_SPACING_DEG;
  }

  async summarize(input: HistoricalAreaSummaryQueryInput): Promise<HistoricalAreaSummaryResult> {
    const query = this.allowNonAnalysisCycle
      ? historicalAreaSummaryQuerySchema.safeExtend({ analysisTime: isoDateTimeSchema }).parse(input)
      : historicalAreaSummaryQuerySchema.parse(input);
    const analysisTime = new Date(query.analysisTime);
    if (analysisTime < this.minimumTime) {
      throw new Error(
        `GFS Grid 4 history begins at ${this.minimumTime.toISOString()} for this data source`,
      );
    }
    if (analysisTime > this.now()) {
      throw new Error("Historical GFS analysisTime must not be in the future");
    }

    const bbox = {
      westLongitude: query.westLongitude,
      eastLongitude: query.eastLongitude,
      southLatitude: query.southLatitude,
      northLatitude: query.northLatitude,
    };
    const estimatedGridPoints = estimateHistoricalGridPoints(bbox, this.gridSpacingDegrees);
    if (estimatedGridPoints > query.maxGridPoints) {
      throw new InvalidRequestError(
        `Requested bbox is approximately ${estimatedGridPoints} historical GFS grid points, exceeding maxGridPoints=${query.maxGridPoints}`,
      );
    }

    const definition = query.field === undefined
      ? HISTORICAL_AREA_PRESSURE_CATALOG[query.variable!]
      : HISTORICAL_AREA_FIELD_CATALOG[query.field];
    const verticalCoordinate = definition.verticalCoordinate?.(
      query.pressureLevelHpa === undefined ? {} : { pressureLevelHpa: query.pressureLevelHpa },
    );
    const response = await this.source.fetchArea({
      analysisTime,
      ...bbox,
      variable: definition.id,
      ...(verticalCoordinate === undefined ? {} : { verticalCoordinate }),
    });
    const points = normalizeHistoricalAreaPoints(response, definition, verticalCoordinate);
    const computed = computeAreaDistribution(points, {
      percentiles: query.percentiles,
      thresholds: query.thresholds,
      includeExtremaLocations: query.includeExtremaLocations,
    });
    const distributionRequested = query.includeExtremaLocations
      || (query.percentiles?.length ?? 0) > 0
      || (query.thresholds?.length ?? 0) > 0;

    return historicalAreaSummaryResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      bbox,
      ...(query.field === undefined
        ? {
            variable: {
              id: query.variable!,
              pressureHpa: query.pressureLevelHpa!,
              field: definition.outputField,
              unit: definition.unit,
            },
          }
        : {
            field: {
              id: query.field,
              level: historicalAreaFieldLevel(query.field),
              temporal: { type: "instantaneous" },
              output: {
                field: definition.outputField,
                unit: definition.unit,
              },
            },
          }),
      statistics: {
        ...computed.statistics,
        meanKind: "unweighted_grid_point_mean",
      },
      ...(distributionRequested ? { distribution: computed.distribution } : {}),
      source: {
        provider: response.provider,
        access: response.access,
        subset: "native_bbox_grid",
        dataset: response.dataset,
        cacheHit: response.cacheHit,
      },
      caveat: CAVEAT,
    });
  }
}

export function estimateHistoricalGridPoints(box: {
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
}, gridSpacingDegrees = GRID_SPACING_DEG): number {
  const longitudePoints = Math.ceil(
    (box.eastLongitude - box.westLongitude) / gridSpacingDegrees,
  ) + 2;
  const latitudePoints = Math.ceil(
    (box.northLatitude - box.southLatitude) / gridSpacingDegrees,
  ) + 2;
  return Math.max(0, longitudePoints) * Math.max(0, latitudePoints);
}

function normalizeHistoricalAreaPoints(
  response: Awaited<ReturnType<HistoricalAnalysisAreaDataSource["fetchArea"]>>,
  definition: HistoricalAreaSourceDefinition,
  expectedVerticalCoordinate?: number,
): GridValuePoint[] {
  if (response.variable !== definition.id) {
    throw new Error(
      `Historical GFS area source returned ${response.variable} for requested ${definition.id}`,
    );
  }
  if (
    expectedVerticalCoordinate !== undefined
    && response.verticalCoordinate !== undefined
    && Math.abs(response.verticalCoordinate - expectedVerticalCoordinate) > 1e-6
  ) {
    throw new Error(
      `Historical GFS area source returned vertical coordinate ${response.verticalCoordinate} instead of ${expectedVerticalCoordinate} for ${definition.id}`,
    );
  }
  if (response.points.length === 0) {
    throw new Error(`Historical GFS area response contains no defined grid values for ${definition.id}`);
  }
  return response.points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    value: definition.transform(point.value),
  }));
}
