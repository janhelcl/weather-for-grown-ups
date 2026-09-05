import { homedir } from "node:os";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { CachedGfsAnalysisFileStore, CachedGfsAnalysisSource } from "../cache/historical-gfs-cache.js";
import { RoutedGfsAnalysisSource } from "../sources/gfs-analysis-routed.js";
import {
  GFS_ANALYSIS_START,
  type HistoricalAnalysisAreaDataSource,
  type HistoricalAnalysisAreaResponse,
} from "../sources/gfs-analysis.js";
import {
  HISTORICAL_AREA_FIELD_CATALOG,
  HISTORICAL_AREA_PRESSURE_CATALOG,
  type HistoricalAreaFieldId,
  type HistoricalAreaPressureVariableId,
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

export interface HistoricalAreaSelection {
  field?: string | undefined;
  variable?: string | undefined;
  pressureLevelHpa?: number | undefined;
}

export interface HistoricalAreaSourceSelection {
  definition: HistoricalAreaSourceDefinition;
  verticalCoordinate?: number;
}

export interface HistoricalAreaLoadOptions {
  source: HistoricalAnalysisAreaDataSource;
  analysisTime: Date;
  bbox: {
    westLongitude: number;
    eastLongitude: number;
    southLatitude: number;
    northLatitude: number;
  };
  definition: HistoricalAreaSourceDefinition;
  verticalCoordinate?: number;
  percentiles?: HistoricalAreaSummaryQueryInput["percentiles"];
  thresholds?: HistoricalAreaSummaryQueryInput["thresholds"];
  includeExtremaLocations?: boolean | undefined;
}

export interface HistoricalAreaLoadResult {
  response: HistoricalAnalysisAreaResponse;
  computed: ReturnType<typeof computeAreaDistribution>;
  distributionRequested: boolean;
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
    this.minimumTime = options.minimumTime ?? GFS_ANALYSIS_START;
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

    const selection = resolveHistoricalAreaSourceSelection(query);
    const loaded = await loadHistoricalAreaData({
      source: this.source,
      analysisTime,
      bbox,
      definition: selection.definition,
      ...(selection.verticalCoordinate === undefined
        ? {}
        : { verticalCoordinate: selection.verticalCoordinate }),
      ...(query.percentiles === undefined ? {} : { percentiles: query.percentiles }),
      ...(query.thresholds === undefined ? {} : { thresholds: query.thresholds }),
      includeExtremaLocations: query.includeExtremaLocations,
    });
    const publicSource = publicHistoricalAreaSource(loaded.response);

    return historicalAreaSummaryResultSchema.parse({
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      bbox,
      ...(query.field === undefined
        ? {
            variable: {
              id: query.variable!,
              pressureHpa: query.pressureLevelHpa!,
              field: selection.definition.outputField,
              unit: selection.definition.unit,
            },
          }
        : {
            field: {
              id: query.field,
              level: historicalAreaFieldLevel(query.field),
              temporal: { type: "instantaneous" },
              output: {
                field: selection.definition.outputField,
                unit: selection.definition.unit,
              },
            },
          }),
      statistics: {
        ...loaded.computed.statistics,
        meanKind: "unweighted_grid_point_mean",
      },
      ...(loaded.distributionRequested ? { distribution: loaded.computed.distribution } : {}),
      source: {
        ...publicSource,
        subset: "native_bbox_grid",
        dataset: loaded.response.dataset,
        cacheHit: loaded.response.cacheHit,
      },
      caveat: CAVEAT,
    });
  }
}

export function resolveHistoricalAreaSourceSelection(
  selection: HistoricalAreaSelection,
): HistoricalAreaSourceSelection {
  let definition: HistoricalAreaSourceDefinition;
  if (selection.field !== undefined) {
    if (!Object.hasOwn(HISTORICAL_AREA_FIELD_CATALOG, selection.field)) {
      throw new InvalidRequestError(
        `Historical GFS area does not support field ${selection.field}`,
        { details: { supportedFields: Object.keys(HISTORICAL_AREA_FIELD_CATALOG) } },
      );
    }
    definition = HISTORICAL_AREA_FIELD_CATALOG[selection.field as HistoricalAreaFieldId];
  } else {
    if (
      selection.variable === undefined
      || !Object.hasOwn(HISTORICAL_AREA_PRESSURE_CATALOG, selection.variable)
    ) {
      throw new InvalidRequestError(
        `Historical GFS area does not support pressure variable ${selection.variable ?? "<missing>"}`,
        { details: { supportedVariables: Object.keys(HISTORICAL_AREA_PRESSURE_CATALOG) } },
      );
    }
    definition = HISTORICAL_AREA_PRESSURE_CATALOG[
      selection.variable as HistoricalAreaPressureVariableId
    ];
  }
  const verticalCoordinate = definition.verticalCoordinate?.(
    selection.pressureLevelHpa === undefined
      ? {}
      : { pressureLevelHpa: selection.pressureLevelHpa },
  );
  return {
    definition,
    ...(verticalCoordinate === undefined ? {} : { verticalCoordinate }),
  };
}

export async function loadHistoricalAreaData(
  options: HistoricalAreaLoadOptions,
): Promise<HistoricalAreaLoadResult> {
  const response = await options.source.fetchArea({
    analysisTime: options.analysisTime,
    ...options.bbox,
    variable: options.definition.id,
    ...(options.verticalCoordinate === undefined
      ? {}
      : { verticalCoordinate: options.verticalCoordinate }),
  });
  const points = normalizeHistoricalAreaPoints(
    response,
    options.definition,
    options.verticalCoordinate,
  );
  const computed = computeAreaDistribution(points, {
    ...(options.percentiles === undefined ? {} : { percentiles: options.percentiles }),
    ...(options.thresholds === undefined ? {} : { thresholds: options.thresholds }),
    includeExtremaLocations: options.includeExtremaLocations ?? false,
  });
  const distributionRequested = (options.includeExtremaLocations ?? false)
    || (options.percentiles?.length ?? 0) > 0
    || (options.thresholds?.length ?? 0) > 0;
  return { response, computed, distributionRequested };
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

function publicHistoricalAreaSource(
  response: HistoricalAnalysisAreaResponse,
): Pick<HistoricalAreaSummaryResult["source"], "provider" | "access"> {
  if (response.provider === "NCAR GDEX" || response.access === "gdex_thredds_ncss") {
    throw new Error("gfs-analysis area source returned archive-only GDEX provenance");
  }
  return { provider: response.provider, access: response.access };
}

function normalizeHistoricalAreaPoints(
  response: HistoricalAnalysisAreaResponse,
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
