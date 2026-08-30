import { gefsRunComparisonQuerySchema } from "../../schema/gefs-run-comparison.js";
import { ifsEnsRunComparisonQuerySchema } from "../../schema/ifs-ens-run-comparison.js";
import { ifsRunComparisonQuerySchema } from "../../schema/ifs-run-comparison.js";
import { runComparisonQuerySchema } from "../../schema/query.js";
import type { CompareAtmosphericRunsRequest } from "../../schema/unified-specialized.js";
import { GefsRunComparisonService } from "../gefs-run-comparison.js";
import { IfsEnsRunComparisonService } from "../ifs-ens-run-comparison.js";
import { IfsRunComparisonService } from "../ifs-run-comparison.js";
import { RunComparisonService } from "../run-comparison.js";
import type { AtmosphericRunComparisonAdapter } from "./types.js";

export class GfsRunComparisonAdapter implements AtmosphericRunComparisonAdapter {
  constructor(
    private readonly service: Pick<RunComparisonService, "compareRuns"> = new RunComparisonService(),
  ) {}

  compare(request: CompareAtmosphericRunsRequest): Promise<unknown> {
    if (request.dataset !== "gfs") throw new Error("GFS run-comparison adapter requires dataset=gfs");
    return this.service.compareRuns(runComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      anchorRun: request.anchorRun,
      ...(request.gfsGrid === undefined ? {} : { grid: request.gfsGrid }),
      validTime: request.time.at,
      ...(request.selection.variables === undefined
        ? {}
        : { variables: request.selection.variables }),
      ...(request.selection.pressureLevelsHpa === undefined
        ? {}
        : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
      ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
      cycles: request.cycles,
    }));
  }
}

export class GefsRunComparisonAdapter implements AtmosphericRunComparisonAdapter {
  constructor(
    private readonly service: Pick<GefsRunComparisonService, "compareRuns"> =
      new GefsRunComparisonService(),
  ) {}

  compare(request: CompareAtmosphericRunsRequest): Promise<unknown> {
    if (request.dataset !== "gefs") {
      throw new Error("GEFS run-comparison adapter requires dataset=gefs");
    }
    return this.service.compareRuns(gefsRunComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      anchorRun: request.anchorRun,
      validTime: request.time.at,
      variable: request.selection.variables![0],
      pressureLevelHpa: request.selection.pressureLevelsHpa![0],
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined
        ? {}
        : { quantiles: request.ensemble.quantiles }),
      ...(request.thresholdGte === undefined ? {} : { thresholdGte: request.thresholdGte }),
      cycles: request.cycles,
    }));
  }
}

export class IfsRunComparisonAdapter implements AtmosphericRunComparisonAdapter {
  constructor(
    private readonly service: Pick<IfsRunComparisonService, "compareRuns"> =
      new IfsRunComparisonService(),
  ) {}

  compare(request: CompareAtmosphericRunsRequest): Promise<unknown> {
    if (request.dataset !== "ifs") throw new Error("IFS run-comparison adapter requires dataset=ifs");
    return this.service.compareRuns(ifsRunComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      anchorRun: request.anchorRun,
      validTime: request.time.at,
      ...(request.selection.variables === undefined
        ? {}
        : { variables: request.selection.variables }),
      ...(request.selection.pressureLevelsHpa === undefined
        ? {}
        : { pressureLevelsHpa: request.selection.pressureLevelsHpa }),
      ...(request.selection.fields === undefined ? {} : { fields: request.selection.fields }),
      cycles: request.cycles,
    }));
  }
}

export class IfsEnsRunComparisonAdapter implements AtmosphericRunComparisonAdapter {
  constructor(
    private readonly service: Pick<IfsEnsRunComparisonService, "compareRuns"> =
      new IfsEnsRunComparisonService(),
  ) {}

  compare(request: CompareAtmosphericRunsRequest): Promise<unknown> {
    if (request.dataset !== "ifs-ens") {
      throw new Error("IFS ENS run-comparison adapter requires dataset=ifs-ens");
    }
    return this.service.compareRuns(ifsEnsRunComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      anchorRun: request.anchorRun,
      validTime: request.time.at,
      variable: request.selection.variables![0],
      pressureLevelHpa: request.selection.pressureLevelsHpa![0],
      ...(request.ensemble?.members === undefined ? {} : { members: request.ensemble.members }),
      ...(request.ensemble?.quantiles === undefined
        ? {}
        : { quantiles: request.ensemble.quantiles }),
      ...(request.thresholdGte === undefined ? {} : { thresholdGte: request.thresholdGte }),
      ...(request.cycleStrideHours === undefined
        ? {}
        : { cycleStrideHours: request.cycleStrideHours }),
      cycles: request.cycles,
    }));
  }
}
