import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOMADS_COOLDOWN_MS, FileRateLimiter } from "../cache/file-rate-limiter.js";
import {
  HISTORICAL_AREA_FIELD_CATALOG,
  HISTORICAL_AREA_PRESSURE_CATALOG,
  historicalAreaVariableAliases,
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
import {
  NCEI_GFS_GRID4_ANALYSIS_START,
  NceiGfsHistorySource,
  type HistoricalAnalysisAreaDataSource,
} from "../sources/ncei-gfs-history.js";
import { computeAreaDistribution } from "./area-distribution.js";

const GRID_SPACING_DEG = 0.5;
const CAVEAT = "GFS model analysis area statistics; not direct observations or homogeneous climatological reanalysis" as const;

export interface HistoricalAreaSummaryServiceOptions {
  cacheDir?: string;
  cooldownMs?: number;
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
    const limiter = new FileRateLimiter(
      join(cacheDir, "state"),
      options.cooldownMs ?? DEFAULT_NOMADS_COOLDOWN_MS,
    );
    this.source = options.source ?? new NceiGfsHistorySource({
      cacheDir: join(cacheDir, "ncei-history"),
      limiter,
    });
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
        `NCEI GFS Grid 4 history begins at ${this.minimumTime.toISOString()} for this data source`,
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
      throw new Error(
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
      variables: [definition.ncssName],
      ...(verticalCoordinate === undefined ? {} : { verticalCoordinate }),
    });
    const points = parseHistoricalAreaCsv(response.csv, definition, verticalCoordinate);
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
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
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

export function parseHistoricalAreaCsv(
  csv: string,
  definition: HistoricalAreaSourceDefinition,
  expectedVerticalCoordinate?: number,
): GridValuePoint[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("NCEI historical GFS area response contains no data rows");

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  if (latitudeIndex < 0 || longitudeIndex < 0) {
    throw new Error("NCEI historical GFS area response is missing latitude/longitude coordinates");
  }

  const variableIndex = findHeaderIndex(
    headers,
    historicalAreaVariableAliases(definition.ncssName),
  );
  const verticalIndex = expectedVerticalCoordinate === undefined
    ? -1
    : headers.findIndex((header) =>
        header.startsWith("isobaric")
        || header.startsWith("height_above_ground")
        || header === "vertCoord"
      );
  if (variableIndex < 0) {
    throw new Error(
      `NCEI historical GFS area response is missing variable ${definition.ncssName}`,
    );
  }
  if (expectedVerticalCoordinate !== undefined && verticalIndex < 0) {
    throw new Error(
      `NCEI historical GFS area response is missing the vertical coordinate needed to verify ${definition.id}`,
    );
  }

  const points: GridValuePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const latitude = numericCell(cells[latitudeIndex]);
    const longitude = numericCell(cells[longitudeIndex]);
    const rawValue = numericCell(cells[variableIndex]);
    if (expectedVerticalCoordinate !== undefined) {
      const returnedVerticalCoordinate = numericCell(cells[verticalIndex]);
      if (
        returnedVerticalCoordinate !== undefined
        && Math.abs(returnedVerticalCoordinate - expectedVerticalCoordinate) > 1e-6
      ) {
        throw new Error(
          `NCEI historical GFS area returned vertical coordinate ${returnedVerticalCoordinate} instead of requested ${expectedVerticalCoordinate} for ${definition.id}`,
        );
      }
    }
    if (latitude === undefined || longitude === undefined || rawValue === undefined) continue;
    points.push({
      latitude,
      longitude: normalizeLongitude(longitude),
      value: definition.transform(rawValue),
    });
  }
  if (points.length === 0) {
    throw new Error(
      `NCEI historical GFS area response contains no defined grid values for ${definition.id}`,
    );
  }
  return points;
}

function normalizeLongitude(longitude: number): number {
  return longitude > 180 ? longitude - 360 : longitude;
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").replace(/\[.*$/, "").trim();
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function numericCell(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "nan") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  cells.push(value);
  return cells;
}
