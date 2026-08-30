import { GefsRunComparisonService } from "./gefs-run-comparison.js";
import { GefsIfsEnsComparisonService } from "./gefs-ifs-ens-comparison.js";
import { GfsGefsComparisonService } from "./gfs-gefs-comparison.js";
import { GfsIfsComparisonService } from "./gfs-ifs-comparison.js";
import { HistoricalIndexService } from "./history-index.js";
import { HistoricalForecastSkillService } from "./history-skill.js";
import { HistoricalForecastVerificationService } from "./history-verification.js";
import { IgraForecastVerificationService } from "./igra-verification.js";
import { IgraForecastSkillService } from "./igra-skill.js";
import { IfsEnsRunComparisonService } from "./ifs-ens-run-comparison.js";
import { IfsIfsEnsComparisonService } from "./ifs-ifs-ens-comparison.js";
import { IfsRunComparisonService } from "./ifs-run-comparison.js";
import { RunComparisonService } from "./run-comparison.js";
import { gefsRunComparisonQuerySchema } from "../schema/gefs-run-comparison.js";
import { gefsIfsEnsComparisonQuerySchema } from "../schema/gefs-ifs-ens-comparison.js";
import { gfsGefsComparisonQuerySchema } from "../schema/gfs-gefs-comparison.js";
import { gfsIfsComparisonQuerySchema } from "../schema/gfs-ifs-comparison.js";
import { historicalAnalogQuerySchema } from "../schema/history-index.js";
import { historicalForecastVerificationQuerySchema } from "../schema/history-verification.js";
import { ifsEnsRunComparisonQuerySchema } from "../schema/ifs-ens-run-comparison.js";
import { ifsIfsEnsComparisonQuerySchema } from "../schema/ifs-ifs-ens-comparison.js";
import { ifsRunComparisonQuerySchema } from "../schema/ifs-run-comparison.js";
import { runComparisonQuerySchema } from "../schema/query.js";
import {
  compareAtmosphericDatasetsSchema,
  compareGefsIfsEnsDatasetsSchema,
  compareIfsIfsEnsDatasetsSchema,
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
    private readonly ifs: Pick<IfsRunComparisonService, "compareRuns"> = new IfsRunComparisonService(),
    private readonly ifsEns: Pick<IfsEnsRunComparisonService, "compareRuns"> = new IfsEnsRunComparisonService(),
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

    if (request.dataset === "ifs") {
      const result = await this.ifs.compareRuns(ifsRunComparisonQuerySchema.parse({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        anchorRun: request.anchorRun,
        validTime: request.time.at,
        ...(request.selection.variables === undefined ? {} : { variables: request.selection.variables }),
        ...(request.selection.pressureLevelsHpa === undefined
          ? {}
          : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
        ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
        cycles: request.cycles,
      }));
      return wrap("compare_runs", ["ifs"], result);
    }

    if (request.ensemble?.includeMembers !== undefined || request.ensemble?.maxMemberSamples !== undefined) {
      throw new Error("Ensemble run comparison returns distribution shifts only; includeMembers/maxMemberSamples are not applicable");
    }

    if (request.dataset === "ifs-ens") {
      const result = await this.ifsEns.compareRuns(ifsEnsRunComparisonQuerySchema.parse({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        anchorRun: request.anchorRun,
        validTime: request.time.at,
        variable: request.selection.variables![0],
        pressureLevelHpa: request.selection.pressureLevelsHpa![0],
        ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
        ...(request.ensemble?.quantiles === undefined ? {} : { quantiles: request.ensemble.quantiles }),
        ...(request.thresholdGte === undefined ? {} : { thresholdGte: request.thresholdGte }),
        ...(request.cycleStrideHours === undefined ? {} : { cycleStrideHours: request.cycleStrideHours }),
        cycles: request.cycles,
      }));
      return wrap("compare_runs", ["ifs-ens"], result);
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
    private readonly gfsGefs: Pick<GfsGefsComparisonService, "compare"> = new GfsGefsComparisonService(),
    private readonly gfsIfs: Pick<GfsIfsComparisonService, "compare"> = new GfsIfsComparisonService(),
    private readonly gefsIfsEns: Pick<GefsIfsEnsComparisonService, "compare"> = new GefsIfsEnsComparisonService(),
    private readonly ifsIfsEns: Pick<IfsIfsEnsComparisonService, "compare"> = new IfsIfsEnsComparisonService(),
  ) {}

  async compare(input: CompareAtmosphericDatasetsInput): Promise<UnifiedSpecializedResult> {
    const request = compareAtmosphericDatasetsSchema.parse(input);

    if (request.datasets[1] === "gefs") {
      const result = await this.gfsGefs.compare(gfsGefsComparisonQuerySchema.parse({
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

    if (request.datasets[0] === "gefs") {
      const ensembleRequest = compareGefsIfsEnsDatasetsSchema.parse(request);
      const result = await this.gefsIfsEns.compare(gefsIfsEnsComparisonQuerySchema.parse({
        latitude: ensembleRequest.geometry.latitude,
        longitude: ensembleRequest.geometry.longitude,
        run: ensembleRequest.run,
        validTime: ensembleRequest.time.at,
        variable: ensembleRequest.variable,
        pressureLevelHpa: ensembleRequest.pressureLevelHpa,
        ...(ensembleRequest.gefsMembers === undefined ? {} : { gefsMembers: ensembleRequest.gefsMembers }),
        ...(ensembleRequest.ifsEnsMembers === undefined ? {} : { ifsEnsMembers: ensembleRequest.ifsEnsMembers }),
        ...(ensembleRequest.quantiles === undefined ? {} : { quantiles: ensembleRequest.quantiles }),
        ...(ensembleRequest.thresholdGte === undefined ? {} : { thresholdGte: ensembleRequest.thresholdGte }),
      }));
      return wrap("compare_datasets", ["gefs", "ifs-ens"], result);
    }

    if (request.datasets[0] === "ifs") {
      const controlRequest = compareIfsIfsEnsDatasetsSchema.parse(request);
      const result = await this.ifsIfsEns.compare(ifsIfsEnsComparisonQuerySchema.parse({
        latitude: controlRequest.geometry.latitude,
        longitude: controlRequest.geometry.longitude,
        run: controlRequest.run,
        validTime: controlRequest.time.at,
        variable: controlRequest.variable,
        pressureLevelHpa: controlRequest.pressureLevelHpa,
        ...(controlRequest.ifsEnsMembers === undefined
          ? {}
          : { members: controlRequest.ifsEnsMembers }),
        ...(controlRequest.quantiles === undefined
          ? {}
          : { quantiles: controlRequest.quantiles }),
      }));
      return wrap("compare_datasets", ["ifs", "ifs-ens"], result);
    }

    const result = await this.gfsIfs.compare(gfsIfsComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.run,
      ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
      validTime: request.time.at,
      variable: request.variable,
      pressureLevelHpa: request.pressureLevelHpa,
    }));
    return wrap("compare_datasets", ["gfs", "ifs"], result);
  }
}

export class UnifiedForecastVerificationService {
  constructor(
    private readonly analysisService: Pick<HistoricalForecastVerificationService, "verify"> =
      new HistoricalForecastVerificationService(),
    private readonly igraService: Pick<IgraForecastVerificationService, "verify"> =
      new IgraForecastVerificationService(),
    private readonly igraSkillService: Pick<IgraForecastSkillService, "summarize"> =
      new IgraForecastSkillService(),
    private readonly analysisSkillService: Pick<HistoricalForecastSkillService, "summarize"> =
      new HistoricalForecastSkillService(),
  ) {}

  async verify(input: VerifyAtmosphericForecastInput): Promise<UnifiedSpecializedResult> {
    const request = verifyAtmosphericForecastSchema.parse(input);

    if (Array.isArray(request.leadHours)) {
      const rangeTime = request.time as {
        from: string;
        to: string;
        hoursUtc: Array<0 | 6 | 12 | 18>;
        maxValidTimes: number;
      };

      if (request.referenceDataset === "igra") {
        const result = await this.igraSkillService.summarize({
          latitude: request.geometry.latitude,
          longitude: request.geometry.longitude,
          startTime: rangeTime.from,
          endTime: rangeTime.to,
          cycleHoursUtc: rangeTime.hoursUtc,
          maxValidTimes: rangeTime.maxValidTimes,
          leadHours: request.leadHours,
          variables: request.variables as any,
          pressureLevelsHpa: request.pressureLevelsHpa,
          ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
          ...(request.stationId === undefined ? {} : { stationId: request.stationId }),
          ...(request.maxStationDistanceKm === undefined
            ? {}
            : { maxStationDistanceKm: request.maxStationDistanceKm }),
        });
        return wrap("verify_forecast", ["gfs", "igra"], result);
      }

      const result = await this.analysisSkillService.summarize({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        startTime: rangeTime.from,
        endTime: rangeTime.to,
        cycleHoursUtc: rangeTime.hoursUtc,
        maxValidTimes: rangeTime.maxValidTimes,
        leadHours: request.leadHours,
        variables: request.variables as any,
        pressureLevelsHpa: request.pressureLevelsHpa,
      });
      return wrap("verify_forecast", ["gfs", "gfs-analysis"], result);
    }

    const instantTime = request.time as { at: string };

    if (request.referenceDataset === "igra") {
      const result = await this.igraService.verify({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        validTime: instantTime.at,
        leadHours: request.leadHours,
        variables: request.variables as any,
        pressureLevelsHpa: request.pressureLevelsHpa,
        ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
        ...(request.stationId === undefined ? {} : { stationId: request.stationId }),
        ...(request.maxStationDistanceKm === undefined
          ? {}
          : { maxStationDistanceKm: request.maxStationDistanceKm }),
      });
      return wrap("verify_forecast", ["gfs", "igra"], result);
    }

    const result = await this.analysisService.verify(historicalForecastVerificationQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      validTime: instantTime.at,
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
