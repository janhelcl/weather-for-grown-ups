import { gefsIfsEnsComparisonQuerySchema } from "../../schema/gefs-ifs-ens-comparison.js";
import { gfsGefsComparisonQuerySchema } from "../../schema/gfs-gefs-comparison.js";
import { gfsIfsComparisonQuerySchema } from "../../schema/gfs-ifs-comparison.js";
import { ifsIfsEnsComparisonQuerySchema } from "../../schema/ifs-ifs-ens-comparison.js";
import type { CompareAtmosphericDatasetsRequest } from "../../schema/unified-specialized.js";
import { GefsIfsEnsComparisonService } from "../gefs-ifs-ens-comparison.js";
import { GfsGefsComparisonService } from "../gfs-gefs-comparison.js";
import { GfsIfsComparisonService } from "../gfs-ifs-comparison.js";
import { IfsIfsEnsComparisonService } from "../ifs-ifs-ens-comparison.js";
import type { AtmosphericDatasetComparisonAdapter } from "./types.js";

export class GfsGefsDatasetComparisonAdapter implements AtmosphericDatasetComparisonAdapter {
  constructor(
    private readonly service: Pick<GfsGefsComparisonService, "compare"> =
      new GfsGefsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "gefs") {
      throw new Error("GFS/GEFS comparison adapter requires datasets=gfs,gefs");
    }
    return this.service.compare(gfsGefsComparisonQuerySchema.parse({
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
  }
}

export class GfsIfsDatasetComparisonAdapter implements AtmosphericDatasetComparisonAdapter {
  constructor(
    private readonly service: Pick<GfsIfsComparisonService, "compare"> =
      new GfsIfsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "ifs") {
      throw new Error("GFS/IFS comparison adapter requires datasets=gfs,ifs");
    }
    return this.service.compare(gfsIfsComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.run,
      ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
      validTime: request.time.at,
      variable: request.variable,
      pressureLevelHpa: request.pressureLevelHpa,
    }));
  }
}

export class GefsIfsEnsDatasetComparisonAdapter implements AtmosphericDatasetComparisonAdapter {
  constructor(
    private readonly service: Pick<GefsIfsEnsComparisonService, "compare"> =
      new GefsIfsEnsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gefs" || request.datasets[1] !== "ifs-ens") {
      throw new Error("GEFS/IFS ENS comparison adapter requires datasets=gefs,ifs-ens");
    }
    return this.service.compare(gefsIfsEnsComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.run,
      validTime: request.time.at,
      variable: request.variable,
      pressureLevelHpa: request.pressureLevelHpa,
      ...(request.gefsMembers === undefined ? {} : { gefsMembers: request.gefsMembers }),
      ...(request.ifsEnsMembers === undefined
        ? {}
        : { ifsEnsMembers: request.ifsEnsMembers }),
      ...(request.quantiles === undefined ? {} : { quantiles: request.quantiles }),
      ...(request.thresholdGte === undefined ? {} : { thresholdGte: request.thresholdGte }),
    }));
  }
}

export class IfsIfsEnsDatasetComparisonAdapter implements AtmosphericDatasetComparisonAdapter {
  constructor(
    private readonly service: Pick<IfsIfsEnsComparisonService, "compare"> =
      new IfsIfsEnsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs" || request.datasets[1] !== "ifs-ens") {
      throw new Error("IFS/IFS ENS comparison adapter requires datasets=ifs,ifs-ens");
    }
    return this.service.compare(ifsIfsEnsComparisonQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      run: request.run,
      validTime: request.time.at,
      variable: request.variable,
      pressureLevelHpa: request.pressureLevelHpa,
      ...(request.ifsEnsMembers === undefined ? {} : { members: request.ifsEnsMembers }),
      ...(request.quantiles === undefined ? {} : { quantiles: request.quantiles }),
    }));
  }
}
