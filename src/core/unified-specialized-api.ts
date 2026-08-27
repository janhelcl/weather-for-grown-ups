import { GefsRunComparisonService } from "./gefs-run-comparison.js";
import { GfsGefsComparisonService } from "./gfs-gefs-comparison.js";
import { HistoricalIndexService } from "./history-index.js";
import { HistoricalForecastVerificationService } from "./history-verification.js";
import { RunComparisonService } from "./run-comparison.js";
import { gefsRunComparisonQuerySchema } from "../schema/gefs-run-comparison.js";
import { gfsGefsComparisonQuerySchema } from "../schema/gfs-gefs-comparison.js";
import { historicalAnalogQuerySchema } from "../schema/history-index.js";
import { historicalForecastVerificationQuerySchema } from "../schema/history-verification.js";
import { runComparisonQuerySchema } from "../schema/query.js";
import {
  compareAtmosphericDatasetsSchema,
  compareAtmosphericRunsSchema,
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastSchema,
  type CompareAtmosphericDatasetsInput,
  type CompareAtmosphericRunsInput,
  type FindAtmosphericAnalogsInput,
  type UnifiedSpecializedResult,
  type VerifyAtmosphericForecastInput,
} from "../schema/unified-specialized.js";

export class UnifiedRunComparisonService {
  constructor(
    private readonly gfs: Pick<RunComparisonService, "compareRuns"> = new RunComparisonService(),
    private readonly gefs: Pick<GefsRunComparisonService, "compareRuns"> = new GefsRunComparisonService(),
  ) {}

  async compare(input: CompareAtmosphericRunsInput): Promise<UnifiedSpecializedResult> {
    const request = compareAtmosphericRunsSchema.parse(input);

    if (request.dataset === "gfs") {
      const result = await this.gfs.compareRuns(runComparisonQuerySchema.parse({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        anchorRun: request.anchorRun,
        ...(request.gfsGrid === undefined ? {} : { grid: request.gfsGrid }),
        validTime: request.time.at,
        ...(request.selection.variables === undefined ? {} : { variables: request.selection.variables }),
        ...(request.selection.pressureLevelsHpa === undefined
          ? {}
          : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
        ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
        cycles: request.cycles,
      }));
      return wrap("compare_runs", ["gfs"], result);
    }

    if (request.ensemble?.includeMembers !== undefined || request.ensemble?.maxMemberSamples !== undefined) {
      throw new Error("GEFS run comparison returns distribution shifts only; includeMembers/maxMemberSamples are not applicable");
    }

    const result = await this.gefs.compareRuns(gefsRunComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      anchorRun: request.anchorRun,
      validTime: request.time.at,
      variable: request.selection.variables![0],
      pressureLevelHpa: request.selection.pressureLevelsHpa![0],
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
      ...(request.thresholdGte === undefined ? {} : { thresholdGte: request.thresholdGte }),
      cycles: request.cycles,
    }));
    return wrap("compare_runs", ["gefs"], result);
  }
}

export class UnifiedDatasetComparisonService {
  constructor(
    private readonly service: Pick<GfsGefsComparisonService, "compare"> = new GfsGefsComparisonService(),
  ) {}

  async compare(input: CompareAtmosphericDatasetsInput): Promise<UnifiedSpecializedResult> {
    const request = compareAtmosphericDatasetsSchema.parse(input);
    const result = await this.service.compare(gfsGefsComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.run,
      ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
      validTime: request.time.at,
      variable: request.variable,
      pressureLevelHpa: request.pressureLevelHpa,
      ...(request.members === undefined ? {} : { members: request.members }),
      ...(request.quantiles === undefined ? {} : { quantiles: request.quantiles }),
    }));
    return wrap("compare_datasets", ["gfs", "gefs"], result);
  }
}

export class UnifiedForecastVerificationService {
  constructor(
    private readonly service: Pick<HistoricalForecastVerificationService, "verify"> =
      new HistoricalForecastVerificationService(),
  ) {}

  async verify(input: VerifyAtmosphericForecastInput): Promise<UnifiedSpecializedResult> {
    const request = verifyAtmosphericForecastSchema.parse(input);
    const result = await this.service.verify(historicalForecastVerificationQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      validTime: request.time.at,
      leadHours: request.leadHours,
      variables: request.variables,
      pressureLevelsHpa: request.pressureLevelsHpa,
    }));
    return wrap("verify_forecast", ["gfs", "gfs-analysis"], result);
  }
}

export class UnifiedAnalogService {
  constructor(
    private readonly service: Pick<HistoricalIndexService, "findAnalogs"> = new HistoricalIndexService(),
  ) {}

  async find(input: FindAtmosphericAnalogsInput): Promise<UnifiedSpecializedResult> {
    const request = findAtmosphericAnalogsSchema.parse(input);
    const result = await this.service.findAnalogs(historicalAnalogQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      targetTime: request.time.at,
      variables: request.variables,
      pressureLevelsHpa: request.pressureLevelsHpa,
      count: request.count,
      excludeWithinHours: request.excludeWithinHours,
      fetchTargetIfMissing: request.fetchTargetIfMissing,
    }));
    return wrap("find_analogs", ["gfs-analysis"], result);
  }
}

function wrap(
  operation: UnifiedSpecializedResult["operation"],
  datasets: UnifiedSpecializedResult["datasets"],
  result: unknown,
): UnifiedSpecializedResult {
  return unifiedSpecializedResultSchema.parse({ operation, datasets, result });
}
