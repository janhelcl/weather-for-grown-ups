import type { CompareAtmosphericDatasetsRequest } from "../../schema/unified-specialized.js";
import {
  CrossScaleComparisonService,
  type CrossScaleComparisonSelection,
} from "../cross-scale-comparison.js";
import {
  comparisonStrategyMetadata,
  type AtmosphericDatasetComparisonStrategy,
  type AtmosphericDatasetComparisonStrategyMetadata,
} from "./types.js";

type CrossScaleComparisonMechanics = Pick<
  CrossScaleComparisonService,
  "compareDeterministic" | "compareEnsembles"
>;

abstract class CrossScaleComparisonStrategyBase {
  constructor(
    protected readonly service: CrossScaleComparisonMechanics =
      new CrossScaleComparisonService(),
  ) {}
}

const crossScaleMetadata = (
  variableCompatibility:
    AtmosphericDatasetComparisonStrategyMetadata["variableCompatibility"],
) => ({
  outputShape: "normalized_pair_result" as const,
  provenanceShape: "native_source_per_side" as const,
  runAlignment: "shared_explicit_initialization_cycle" as const,
  variableCompatibility,
  spatialOverlapRequirement: "requested_point_within_both_declared_domains" as const,
  pointSamplingSemantics:
    "independent_native_grid_points_at_same_requested_coordinate" as const,
  spatialAlignment: "point_only_no_cross_dataset_regridding" as const,
  nativeResolutionRepresentation:
    "preserve_per_side_native_grid_and_sampling_provenance" as const,
});

export class IfsIconD2ComparisonStrategy
  extends CrossScaleComparisonStrategyBase
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs:icon-d2",
    ["ifs", "icon-d2"],
    "deterministic_delta",
    crossScaleMetadata("pair_specific_pressure_or_field_intersection"),
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs" || request.datasets[1] !== "icon-d2") {
      throw new Error("IFS/ICON-D2 comparison strategy requires datasets=ifs,icon-d2");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs", "icon-d2"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["ifs", "icon-d2"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      selection: selectionFromRequest(query),
    });
  }
}

export class IfsAromeComparisonStrategy
  extends CrossScaleComparisonStrategyBase
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs:arome",
    ["ifs", "arome"],
    "deterministic_delta",
    crossScaleMetadata("pair_specific_field_intersection"),
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "ifs" || request.datasets[1] !== "arome") {
      throw new Error("IFS/AROME comparison strategy requires datasets=ifs,arome");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs", "arome"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["ifs", "arome"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      selection: { kind: "field", field: query.field },
    });
  }
}

export class GfsIconD2ComparisonStrategy
  extends CrossScaleComparisonStrategyBase
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "gfs:icon-d2",
    ["gfs", "icon-d2"],
    "deterministic_delta",
    crossScaleMetadata("pair_specific_pressure_or_field_intersection"),
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (request.datasets[0] !== "gfs" || request.datasets[1] !== "icon-d2") {
      throw new Error("GFS/ICON-D2 comparison strategy requires datasets=gfs,icon-d2");
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["gfs", "icon-d2"] }
    >;
    return this.service.compareDeterministic({
      datasets: ["gfs", "icon-d2"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      selection: selectionFromRequest(query),
      ...(query.gfsGrid === undefined ? {} : { gfsGrid: query.gfsGrid }),
    });
  }
}

export class IfsEnsIconD2EpsComparisonStrategy
  extends CrossScaleComparisonStrategyBase
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs-ens:icon-d2-eps",
    ["ifs-ens", "icon-d2-eps"],
    "ensemble_distribution_shift",
    crossScaleMetadata("pair_specific_scalar_pressure_or_field_intersection"),
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (
      request.datasets[0] !== "ifs-ens"
      || request.datasets[1] !== "icon-d2-eps"
    ) {
      throw new Error(
        "IFS ENS/ICON-D2-EPS comparison strategy requires datasets=ifs-ens,icon-d2-eps",
      );
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs-ens", "icon-d2-eps"] }
    >;
    return this.service.compareEnsembles({
      datasets: ["ifs-ens", "icon-d2-eps"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      selection: selectionFromRequest(query),
      ...(query.ifsEnsMembers === undefined
        ? {}
        : { leftMembers: query.ifsEnsMembers }),
      rightMembers: query.iconD2EpsMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined
        ? {}
        : { thresholdGte: query.thresholdGte }),
    });
  }
}

export class IfsEnsPeAromeComparisonStrategy
  extends CrossScaleComparisonStrategyBase
  implements AtmosphericDatasetComparisonStrategy {
  readonly metadata = comparisonStrategyMetadata(
    "ifs-ens:pe-arome",
    ["ifs-ens", "pe-arome"],
    "ensemble_distribution_shift",
    crossScaleMetadata("pair_specific_scalar_field_intersection"),
  );

  compare(request: CompareAtmosphericDatasetsRequest): Promise<unknown> {
    if (
      request.datasets[0] !== "ifs-ens"
      || request.datasets[1] !== "pe-arome"
    ) {
      throw new Error(
        "IFS ENS/PE-AROME comparison strategy requires datasets=ifs-ens,pe-arome",
      );
    }
    const query = request as Extract<
      CompareAtmosphericDatasetsRequest,
      { datasets: ["ifs-ens", "pe-arome"] }
    >;
    return this.service.compareEnsembles({
      datasets: ["ifs-ens", "pe-arome"],
      latitude: query.geometry.latitude,
      longitude: query.geometry.longitude,
      validTime: query.time.at,
      run: query.run,
      selection: { kind: "field", field: query.field },
      ...(query.ifsEnsMembers === undefined
        ? {}
        : { leftMembers: query.ifsEnsMembers }),
      rightMembers: query.peAromeMembers,
      quantiles: query.quantiles,
      ...(query.thresholdGte === undefined
        ? {}
        : { thresholdGte: query.thresholdGte }),
    });
  }
}

function selectionFromRequest(
  request: {
    field?: string | undefined;
    variable?: string | undefined;
    pressureLevelHpa?: number | undefined;
  },
): CrossScaleComparisonSelection {
  if (request.field !== undefined) {
    return { kind: "field", field: request.field };
  }
  if (request.variable === undefined || request.pressureLevelHpa === undefined) {
    throw new Error("Cross-scale comparison request is missing its declared selection");
  }
  return {
    kind: "pressure",
    variable: request.variable,
    pressureLevelHpa: request.pressureLevelHpa,
  };
}
