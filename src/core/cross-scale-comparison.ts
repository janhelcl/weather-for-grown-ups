import { ICON_D2_EPS_MEMBERS } from "../catalog/icon-d2-eps.js";
import { IFS_ENS_MEMBERS } from "../catalog/ifs-ens.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldId,
} from "../catalog/non-isobaric-fields.js";
import { PE_AROME_MEMBERS } from "../catalog/pe-arome.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  PUBLIC_DATASET_METADATA,
  publicDatasetCapabilities,
  type PublicAtmosphericDataset,
  type QueryAtmosphereInput,
  type UnifiedAtmosphereResult,
} from "../schema/unified-api.js";
import { assertAtmosphericGeometryWithinDomain } from "./atmospheric-domain.js";
import {
  assertAligned,
  circularDifference,
  compareFieldThreshold,
  compareThreshold,
  objectResult,
  publicDeterministicSide,
  publicEnsembleSide,
  requiredDistribution,
  requiredFieldDistribution,
  requiredFieldValue,
  requiredNumber,
  requiredProfileValue,
  requiredQuantile,
  requiredString,
} from "./comparison-result-reader.js";
import { UnifiedAtmosphereQueryService } from "./unified-atmosphere-query.js";

export type CrossScaleComparisonSelection =
  | { kind: "pressure"; variable: string; pressureLevelHpa: number }
  | { kind: "field"; field: string };

export interface CrossScaleComparisonQueryService {
  query(input: QueryAtmosphereInput): Promise<UnifiedAtmosphereResult>;
}

export interface DeterministicCrossScaleComparisonInput {
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset];
  latitude: number;
  longitude: number;
  validTime: string;
  run: string;
  selection: CrossScaleComparisonSelection;
  gfsGrid?: "0p25" | "0p50";
}

export interface EnsembleCrossScaleComparisonInput
  extends DeterministicCrossScaleComparisonInput {
  leftMembers?: readonly string[];
  rightMembers?: readonly string[];
  quantiles: readonly number[];
  thresholdGte?: number;
}

export class CrossScaleComparisonService {
  constructor(
    private readonly queryService: CrossScaleComparisonQueryService =
      new UnifiedAtmosphereQueryService(),
  ) {}

  async compareDeterministic(
    input: DeterministicCrossScaleComparisonInput,
  ): Promise<unknown> {
    assertPointCoveredByBothDatasets(input);
    const [left, right] = await Promise.all([
      this.queryService.query(deterministicQuery(input.datasets[0], input)),
      this.queryService.query(deterministicQuery(input.datasets[1], input)),
    ]);
    const leftResult = objectResult(left);
    const rightResult = objectResult(right);
    assertAligned(leftResult, rightResult, input.datasets);

    const outputs = outputsForSelection(input.selection).map((output) => {
      const leftValue = deterministicValue(
        leftResult,
        input.selection,
        output.field,
        input.datasets[0],
      );
      const rightValue = deterministicValue(
        rightResult,
        input.selection,
        output.field,
        input.datasets[1],
      );
      const deltaKind = output.field === "windDirectionDeg"
        ? "circular_degrees" as const
        : "linear" as const;
      return {
        field: output.field,
        unit: output.unit,
        leftValue,
        rightValue,
        rightMinusLeft: deltaKind === "circular_degrees"
          ? circularDifference(rightValue, leftValue)
          : rightValue - leftValue,
        deltaKind,
      };
    });

    return {
      run: requiredString(leftResult.run, "cross-scale comparison run"),
      validTime: requiredString(leftResult.validTime, "cross-scale comparison validTime"),
      forecastHour: requiredNumber(
        leftResult.forecastHour,
        "cross-scale comparison forecastHour",
      ),
      requestedPoint: { latitude: input.latitude, longitude: input.longitude },
      selection: publicSelection(input.selection),
      alignment: crossScaleAlignment(input.datasets),
      left: {
        ...publicDeterministicSide(
          input.datasets[0],
          leftResult,
          outputs.map((value) => ({
            field: value.field,
            unit: value.unit,
            value: value.leftValue,
          })),
        ),
        spatialContext: datasetSpatialContext(input.datasets[0]),
      },
      right: {
        ...publicDeterministicSide(
          input.datasets[1],
          rightResult,
          outputs.map((value) => ({
            field: value.field,
            unit: value.unit,
            value: value.rightValue,
          })),
        ),
        spatialContext: datasetSpatialContext(input.datasets[1]),
      },
      comparison: {
        outputs,
        interpretation:
          "raw_cross_scale_point_difference_not_error_not_downscaled_value",
      },
    };
  }

  async compareEnsembles(
    input: EnsembleCrossScaleComparisonInput,
  ): Promise<unknown> {
    assertPointCoveredByBothDatasets(input);
    const output = scalarOutputForSelection(input.selection);
    const leftMembers = input.leftMembers ?? defaultMembers(input.datasets[0]);
    const rightMembers = input.rightMembers ?? defaultMembers(input.datasets[1]);
    const includeMembers = input.thresholdGte !== undefined;

    const [left, right] = await Promise.all([
      this.queryService.query(ensembleQuery(
        input.datasets[0],
        input,
        leftMembers,
        includeMembers,
      )),
      this.queryService.query(ensembleQuery(
        input.datasets[1],
        input,
        rightMembers,
        includeMembers,
      )),
    ]);
    const leftResult = objectResult(left);
    const rightResult = objectResult(right);
    assertAligned(leftResult, rightResult, input.datasets);

    const leftDistribution = distributionForSelection(
      leftResult,
      input.selection,
      output.field,
      input.datasets[0],
    );
    const rightDistribution = distributionForSelection(
      rightResult,
      input.selection,
      output.field,
      input.datasets[1],
    );
    const quantiles = [...input.quantiles].sort((a, b) => a - b);
    const quantileShifts = quantiles.map((quantile) => {
      const leftValue = requiredQuantile(
        leftDistribution.quantiles,
        quantile,
        input.datasets[0],
      );
      const rightValue = requiredQuantile(
        rightDistribution.quantiles,
        quantile,
        input.datasets[1],
      );
      return {
        quantile,
        leftValue,
        rightValue,
        rightMinusLeft: rightValue - leftValue,
      };
    });
    const threshold = input.thresholdGte === undefined
      ? undefined
      : thresholdForSelection(
          leftResult,
          rightResult,
          input.datasets,
          input.selection,
          output.field,
          input.thresholdGte,
        );

    return {
      run: requiredString(leftResult.run, "cross-scale ensemble comparison run"),
      validTime: requiredString(
        leftResult.validTime,
        "cross-scale ensemble comparison validTime",
      ),
      forecastHour: requiredNumber(
        leftResult.forecastHour,
        "cross-scale ensemble comparison forecastHour",
      ),
      requestedPoint: { latitude: input.latitude, longitude: input.longitude },
      selection: {
        ...publicSelection(input.selection),
        outputField: output.field,
        unit: output.unit,
      },
      alignment: crossScaleAlignment(input.datasets),
      left: {
        ...publicEnsembleSide(input.datasets[0], leftResult, leftDistribution),
        spatialContext: datasetSpatialContext(input.datasets[0]),
      },
      right: {
        ...publicEnsembleSide(input.datasets[1], rightResult, rightDistribution),
        spatialContext: datasetSpatialContext(input.datasets[1]),
      },
      comparison: {
        rightMinusLeftMean: rightDistribution.mean - leftDistribution.mean,
        rightMinusLeftPopulationStdDev:
          rightDistribution.populationStdDev - leftDistribution.populationStdDev,
        populationStdDevRatioRightToLeft: leftDistribution.populationStdDev === 0
          ? null
          : rightDistribution.populationStdDev / leftDistribution.populationStdDev,
        quantileShifts,
        ...(threshold === undefined ? {} : { threshold }),
        interpretation:
          "independent_raw_cross_scale_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
      },
    };
  }
}

function deterministicQuery(
  dataset: PublicAtmosphericDataset,
  input: DeterministicCrossScaleComparisonInput,
): QueryAtmosphereInput {
  return {
    dataset,
    geometry: {
      type: "point",
      latitude: input.latitude,
      longitude: input.longitude,
    },
    time: { at: input.validTime },
    selection: querySelection(input.selection),
    forecast: {
      run: input.run,
      ...(dataset === "gfs" && input.gfsGrid !== undefined
        ? { grid: input.gfsGrid }
        : {}),
    },
  };
}

function ensembleQuery(
  dataset: PublicAtmosphericDataset,
  input: EnsembleCrossScaleComparisonInput,
  members: readonly string[],
  includeMembers: boolean,
): QueryAtmosphereInput {
  return {
    dataset,
    geometry: {
      type: "point",
      latitude: input.latitude,
      longitude: input.longitude,
    },
    time: { at: input.validTime },
    selection: querySelection(input.selection),
    forecast: { run: input.run },
    ensemble: {
      members: [...members],
      quantiles: [...input.quantiles],
      ...(includeMembers ? { includeMembers: true } : {}),
    },
  };
}

function querySelection(selection: CrossScaleComparisonSelection) {
  return selection.kind === "pressure"
    ? {
        variables: [selection.variable],
        pressureLevelsHpa: [selection.pressureLevelHpa],
      }
    : { fields: [selection.field] };
}

function outputsForSelection(selection: CrossScaleComparisonSelection) {
  if (selection.kind === "pressure") {
    const definition = VARIABLE_CATALOG[
      selection.variable as keyof typeof VARIABLE_CATALOG
    ];
    if (!definition) {
      throw new Error(`Unknown cross-scale pressure variable: ${selection.variable}`);
    }
    return definition.outputs;
  }
  const definition = NON_ISOBARIC_FIELD_CATALOG[
    selection.field as NonIsobaricFieldId
  ];
  if (!definition) throw new Error(`Unknown cross-scale field: ${selection.field}`);
  return definition.outputs;
}

function scalarOutputForSelection(selection: CrossScaleComparisonSelection) {
  const outputs = outputsForSelection(selection);
  if (outputs.length !== 1) {
    const label = selection.kind === "pressure" ? selection.variable : selection.field;
    throw new Error(
      `Cross-scale ensemble comparison requires one scalar output for ${label}`,
    );
  }
  return outputs[0]!;
}

function deterministicValue(
  result: ReturnType<typeof objectResult>,
  selection: CrossScaleComparisonSelection,
  outputField: string,
  dataset: string,
): number {
  return selection.kind === "pressure"
    ? requiredProfileValue(
        result,
        selection.pressureLevelHpa,
        outputField,
        dataset,
      )
    : requiredFieldValue(result, selection.field, outputField, dataset);
}

function distributionForSelection(
  result: ReturnType<typeof objectResult>,
  selection: CrossScaleComparisonSelection,
  outputField: string,
  dataset: string,
) {
  return selection.kind === "pressure"
    ? requiredDistribution(
        result,
        selection.variable,
        selection.pressureLevelHpa,
        outputField,
        dataset,
      )
    : requiredFieldDistribution(result, selection.field, outputField, dataset);
}

function thresholdForSelection(
  left: ReturnType<typeof objectResult>,
  right: ReturnType<typeof objectResult>,
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset],
  selection: CrossScaleComparisonSelection,
  outputField: string,
  threshold: number,
) {
  return selection.kind === "pressure"
    ? compareThreshold(
        left,
        right,
        datasets,
        selection.variable,
        selection.pressureLevelHpa,
        outputField,
        threshold,
      )
    : compareFieldThreshold(
        left,
        right,
        datasets,
        selection.field,
        outputField,
        threshold,
      );
}

function publicSelection(selection: CrossScaleComparisonSelection) {
  if (selection.kind === "pressure") {
    const outputs = outputsForSelection(selection);
    return {
      kind: "pressure" as const,
      variable: selection.variable,
      pressureLevelHpa: selection.pressureLevelHpa,
      outputs: outputs.map((output) => ({
        field: output.field,
        unit: output.unit,
      })),
    };
  }
  const definition = NON_ISOBARIC_FIELD_CATALOG[
    selection.field as NonIsobaricFieldId
  ];
  return {
    kind: "field" as const,
    field: selection.field,
    temporalSemantics: definition.temporalSemantics,
    outputs: definition.outputs.map((output) => ({
      field: output.field,
      unit: output.unit,
    })),
  };
}

function datasetSpatialContext(dataset: PublicAtmosphericDataset) {
  const capabilities = publicDatasetCapabilities(dataset);
  return {
    spatialDomain: capabilities.spatialDomain,
    nativeGrid: capabilities.nativeGrid,
    ...(capabilities.horizontalGridDegrees === undefined
      ? {}
      : { declaredHorizontalGridDegrees: capabilities.horizontalGridDegrees }),
  };
}

function crossScaleAlignment(
  datasets: readonly [PublicAtmosphericDataset, PublicAtmosphericDataset],
) {
  return {
    initialization: "shared_explicit_initialization_cycle" as const,
    validTime: "exact" as const,
    forecastHour: "exact" as const,
    spatialOverlap: "requested_point_must_be_inside_both_declared_domains" as const,
    pointSampling:
      "each_dataset_samples_its_own_grid_at_the_same_requested_coordinate" as const,
    crossDatasetRegridding: "none" as const,
    resolutionRepresentation:
      "per_side_native_grid_sampled_grid_point_and_source_provenance" as const,
    datasets: [...datasets],
  };
}

function assertPointCoveredByBothDatasets(
  input: DeterministicCrossScaleComparisonInput,
): void {
  const geometry = {
    type: "point" as const,
    latitude: input.latitude,
    longitude: input.longitude,
  };
  for (const dataset of input.datasets) {
    const metadata = PUBLIC_DATASET_METADATA[dataset];
    assertAtmosphericGeometryWithinDomain(
      dataset,
      metadata.internalDatasetId,
      geometry,
    );
  }
}

function defaultMembers(dataset: PublicAtmosphericDataset): readonly string[] {
  switch (dataset) {
    case "ifs-ens":
      return IFS_ENS_MEMBERS;
    case "icon-d2-eps":
      return ICON_D2_EPS_MEMBERS;
    case "pe-arome":
      return PE_AROME_MEMBERS;
    default:
      throw new Error(
        `Dataset ${dataset} does not have a cross-scale ensemble comparison population`,
      );
  }
}
