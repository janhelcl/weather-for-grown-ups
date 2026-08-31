import type { CompareAtmosphericDatasetsRequest } from "../../schema/unified-specialized.js";
import { ModelClassComparisonService } from "../model-class-comparison.js";
import { comparisonStrategyMetadata, type AtmosphericDatasetComparisonStrategy } from "./types.js";

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
