import { gefsIfsEnsComparisonQuerySchema } from "../../schema/gefs-ifs-ens-comparison.js";
import { gfsGefsComparisonQuerySchema } from "../../schema/gfs-gefs-comparison.js";
import { gfsIfsComparisonQuerySchema } from "../../schema/gfs-ifs-comparison.js";
import { ifsIfsEnsComparisonQuerySchema } from "../../schema/ifs-ifs-ens-comparison.js";
import type { CompareAtmosphericDatasetsRequest } from "../../schema/unified-specialized.js";
import { GefsIfsEnsComparisonService } from "../gefs-ifs-ens-comparison.js";
import { GfsGefsComparisonService } from "../gfs-gefs-comparison.js";
import { GfsIfsComparisonService } from "../gfs-ifs-comparison.js";
import { IfsIfsEnsComparisonService } from "../ifs-ifs-ens-comparison.js";
import { ModelClassComparisonService } from "../model-class-comparison.js";
import { comparisonStrategyMetadata, type AtmosphericDatasetComparisonStrategy } from "./types.js";

export class GfsGefsComparisonStrategy implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gfs:gefs",
    ["gfs", "gefs"],
    "deterministic_ensemble_positioning",
  );

  constructor(
    private readonly service: Pick<GfsGefsComparisonService, "compare"> =
      new GfsGefsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "gefs") {
      throw new Error("GFS/GEFS comparison strategy requires datasets=gfs,gefs");
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

export class GfsIfsComparisonStrategy implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gfs:ifs",
    ["gfs", "ifs"],
    "deterministic_delta",
  );

  constructor(
    private readonly service: Pick<GfsIfsComparisonService, "compare"> =
      new GfsIfsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "ifs") {
      throw new Error("GFS/IFS comparison strategy requires datasets=gfs,ifs");
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

export class GefsIfsEnsComparisonStrategy implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gefs:ifs-ens",
    ["gefs", "ifs-ens"],
    "ensemble_distribution_shift",
  );

  constructor(
    private readonly service: Pick<GefsIfsEnsComparisonService, "compare"> =
      new GefsIfsEnsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gefs" || request.datasets[1] !== "ifs-ens") {
      throw new Error("GEFS/IFS ENS comparison strategy requires datasets=gefs,ifs-ens");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["gefs", "ifs-ens"] }
    >;
    return this.service.compare(gefsIfsEnsComparisonQuerySchema.parse({
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      run: query.run,
      validTime: query.time.at,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      ...(query.gefsMembers === undefined ? {} : { gefsMembers: query.gefsMembers }),
      ...(query.ifsEnsMembers === undefined
        ? {}
        : { ifsEnsMembers: query.ifsEnsMembers }),
      ...(query.quantiles === undefined ? {} : { quantiles: query.quantiles }),
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    }));
  }
}

export class IfsIfsEnsComparisonStrategy implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs:ifs-ens",
    ["ifs", "ifs-ens"],
    "deterministic_ensemble_positioning",
  );

  constructor(
    private readonly service: Pick<IfsIfsEnsComparisonService, "compare"> =
      new IfsIfsEnsComparisonService(),
  ) {}

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs" || request.datasets[1] !== "ifs-ens") {
      throw new Error("IFS/IFS ENS comparison strategy requires datasets=ifs,ifs-ens");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs", "ifs-ens"] }
    >;
    return this.service.compare(ifsIfsEnsComparisonQuerySchema.parse({
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      run: query.run,
      validTime: query.time.at,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      ...(query.ifsEnsMembers === undefined ? {} : { members: query.ifsEnsMembers }),
      ...(query.quantiles === undefined ? {} : { quantiles: query.quantiles }),
    }));
  }
}


abstract class NormalizedModelClassComparisonStrategy {
  constructor(
    protected readonly service: Pick<
      ModelClassComparisonService,
      "compareDeterministic" | "compareEnsembles" | "compareHybridConstituent"
    > = new ModelClassComparisonService(),
  ) {}
}

export class GfsAigfsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gfs:aigfs",
    ["gfs", "aigfs"],
    "deterministic_delta",
    { outputShape: "normalized_pair_result", provenanceShape: "native_source_per_side" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "aigfs") {
      throw new Error("GFS/AIGFS comparison strategy requires datasets=gfs,aigfs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["gfs", "aigfs"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
    });
  }
}

export class IfsAifsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs:aifs",
    ["ifs", "aifs"],
    "deterministic_delta",
    { outputShape: "normalized_pair_result", provenanceShape: "native_source_per_side" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs" || request.datasets[1] !== "aifs") {
      throw new Error("IFS/AIFS comparison strategy requires datasets=ifs,aifs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs", "aifs"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["ifs", "aifs"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
    });
  }
}

export class AigfsAifsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "aigfs:aifs",
    ["aigfs", "aifs"],
    "deterministic_delta",
    { outputShape: "normalized_pair_result", provenanceShape: "native_source_per_side" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "aigfs" || request.datasets[1] !== "aifs") {
      throw new Error("AIGFS/AIFS comparison strategy requires datasets=aigfs,aifs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["aigfs", "aifs"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["aigfs", "aifs"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
    });
  }
}

export class GefsAigefsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gefs:aigefs",
    ["gefs", "aigefs"],
    "ensemble_distribution_shift",
    { outputShape: "normalized_pair_result", provenanceShape: "native_source_per_side" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gefs" || request.datasets[1] !== "aigefs") {
      throw new Error("GEFS/AIGEFS comparison strategy requires datasets=gefs,aigefs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["gefs", "aigefs"] }
    >;
    return this.service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      leftMembers: query.gefsMembers,
      rightMembers: query.aigefsMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    });
  }
}

export class IfsEnsAifsEnsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs-ens:aifs-ens",
    ["ifs-ens", "aifs-ens"],
    "ensemble_distribution_shift",
    { outputShape: "normalized_pair_result", provenanceShape: "native_source_per_side" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs-ens" || request.datasets[1] !== "aifs-ens") {
      throw new Error(
        "IFS ENS/AIFS ENS comparison strategy requires datasets=ifs-ens,aifs-ens",
      );
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs-ens", "aifs-ens"] }
    >;
    return this.service.compareEnsembles({
      datasets: ["ifs-ens", "aifs-ens"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      ...(query.ifsEnsMembers === undefined ? {} : { leftMembers: query.ifsEnsMembers }),
      rightMembers: query.aifsEnsMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    });
  }
}

export class HgefsGefsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "hgefs:gefs",
    ["hgefs", "gefs"],
    "hybrid_constituent_distribution_shift",
    { outputShape: "hybrid_constituent_result", provenanceShape: "hybrid_constituent_sources" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "hgefs" || request.datasets[1] !== "gefs") {
      throw new Error("HGEFS/GEFS comparison strategy requires datasets=hgefs,gefs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["hgefs", "gefs"] }
    >;
    return this.service.compareHybridConstituent({
      constituent: "gefs",
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      members: query.hgefsMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    });
  }
}

export class HgefsAigefsComparisonStrategy
  extends NormalizedModelClassComparisonStrategy
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "hgefs:aigefs",
    ["hgefs", "aigefs"],
    "hybrid_constituent_distribution_shift",
    { outputShape: "hybrid_constituent_result", provenanceShape: "hybrid_constituent_sources" },
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "hgefs" || request.datasets[1] !== "aigefs") {
      throw new Error("HGEFS/AIGEFS comparison strategy requires datasets=hgefs,aigefs");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["hgefs", "aigefs"] }
    >;
    return this.service.compareHybridConstituent({
      constituent: "aigefs",
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      variable: query.variable,
      pressureLevelHpa: query.pressureLevelHpa,
      members: query.hgefsMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
    });
  }
}
