import { LAYER_DIAGNOSTIC_CATALOG, type LayerDiagnosticId } from "../catalog/layer-diagnostics.js";
import type { ProfileDiagnosticId } from "../catalog/profile-diagnostics.js";
import type { ParcelComputation } from "../derived/parcel-diagnostics.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import type { LayerDiagnosticResult, ProfileDiagnosticResult } from "./types.js";

export interface EnsembleLayerDiagnosticMember {
  member: string;
  layer: { depthGpm: number };
  diagnostics: LayerDiagnosticResult[];
}

export interface EnsembleProfileDiagnosticMember {
  member: string;
  diagnostics: ProfileDiagnosticResult[];
}

export function summarizeEnsembleLayerDiagnostics(
  diagnostics: readonly LayerDiagnosticId[],
  members: readonly EnsembleLayerDiagnosticMember[],
  quantiles: readonly number[],
) {
  const summaries = diagnostics.flatMap((id) =>
    LAYER_DIAGNOSTIC_CATALOG[id].outputs.map((output) => {
      const values = members.map((member) => {
        const diagnostic = member.diagnostics.find((candidate) => candidate.id === id);
        const value = diagnostic?.values[output.field];
        if (value === undefined) {
          throw new Error(`Ensemble layer diagnostic aggregation is missing ${id}.${output.field} for ${member.member}`);
        }
        return value;
      });
      return {
        id,
        field: output.field,
        unit: output.unit,
        distribution: summarizeNumericDistribution(values, quantiles),
      };
    }),
  );

  return {
    layerDepthGpm: summarizeNumericDistribution(members.map((member) => member.layer.depthGpm), quantiles),
    summaries,
  };
}

export function summarizeEnsembleProfileDiagnostics(
  diagnostics: readonly ProfileDiagnosticId[],
  members: readonly EnsembleProfileDiagnosticMember[],
  quantiles: readonly number[],
) {
  return diagnostics.map((id) => summarizeProfileDiagnostic(id, members, quantiles));
}

export function summarizeEnsembleParcels(
  parcels: readonly ParcelComputation[],
  quantiles: readonly number[],
) {
  return {
    startingPressureHpa: summarizeNumericDistribution(parcels.map((parcel) => parcel.startingState.pressureHpa), quantiles),
    startingTemperatureC: summarizeNumericDistribution(parcels.map((parcel) => parcel.startingState.temperatureC), quantiles),
    startingSpecificHumidityKgKg: summarizeNumericDistribution(
      parcels.map((parcel) => parcel.startingState.specificHumidityKgKg),
      quantiles,
    ),
    lclPressureHpa: summarizeNumericDistribution(parcels.map((parcel) => parcel.lcl.pressureHpa), quantiles),
    lclTemperatureC: summarizeNumericDistribution(parcels.map((parcel) => parcel.lcl.temperatureC), quantiles),
    capeJkg: summarizeNumericDistribution(parcels.map((parcel) => parcel.capeJkg), quantiles),
    cinJkg: summarizeNumericDistribution(parcels.map((parcel) => parcel.cinJkg), quantiles),
    membersWithPositiveCape: rawMemberEventFraction(
      parcels.filter((parcel) => parcel.capeJkg > 0).length,
      parcels.length,
    ),
    lfc: summarizeBoundary(parcels.map((parcel) => parcel.lfc), parcels.length, quantiles),
    el: summarizeBoundary(parcels.map((parcel) => parcel.el), parcels.length, quantiles),
  };
}

export function rawMemberEventFraction(count: number, memberCount: number) {
  return {
    count,
    memberCount,
    fraction: count / memberCount,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}

function summarizeProfileDiagnostic(
  id: ProfileDiagnosticId,
  members: readonly EnsembleProfileDiagnosticMember[],
  quantiles: readonly number[],
) {
  switch (id) {
    case "freezing_level_crossings": {
      const samples = members.map((member) => {
        const diagnostic = requiredProfileDiagnostic(member, id);
        if (diagnostic.id !== id) throw new Error("Unexpected ensemble freezing-level diagnostic shape");
        return { member: member.member, crossings: diagnostic.crossings };
      });
      const contributors = samples.filter((sample) => sample.crossings.length > 0);
      return {
        id,
        membersWithAnyCrossing: rawMemberEventFraction(contributors.length, members.length),
        crossingCount: summarizeNumericDistribution(samples.map((sample) => sample.crossings.length), quantiles),
        ...(contributors.length === 0
          ? {}
          : {
              lowestCrossing: summarizeCrossingSelection(
                contributors.map((sample) => minimumByHeight(sample.crossings)),
                quantiles,
              ),
              highestCrossing: summarizeCrossingSelection(
                contributors.map((sample) => maximumByHeight(sample.crossings)),
                quantiles,
              ),
            }),
      };
    }
    case "temperature_inversion_layers": {
      const samples = members.map((member) => {
        const diagnostic = requiredProfileDiagnostic(member, id);
        if (diagnostic.id !== id) throw new Error("Unexpected ensemble inversion diagnostic shape");
        return { member: member.member, layers: diagnostic.layers };
      });
      const contributors = samples.filter((sample) => sample.layers.length > 0);
      return {
        id,
        membersWithAnyLayer: rawMemberEventFraction(contributors.length, members.length),
        layerCount: summarizeNumericDistribution(samples.map((sample) => sample.layers.length), quantiles),
        totalLayerDepthGpm: summarizeNumericDistribution(
          samples.map((sample) => sample.layers.reduce((sum, layer) => sum + layer.depthGpm, 0)),
          quantiles,
        ),
        ...(contributors.length === 0
          ? {}
          : {
              deepestLayerDepthGpm: conditionalDistribution(
                contributors.map((sample) => Math.max(...sample.layers.map((layer) => layer.depthGpm))),
                quantiles,
              ),
              strongestTemperatureIncreaseC: conditionalDistribution(
                contributors.map((sample) => Math.max(...sample.layers.map((layer) => layer.temperatureIncreaseC))),
                quantiles,
              ),
              strongestMeanTemperatureGradientCPerKm: conditionalDistribution(
                contributors.map((sample) =>
                  Math.max(...sample.layers.map((layer) => layer.meanTemperatureGradientCPerKm)),
                ),
                quantiles,
              ),
            }),
      };
    }
  }
}

function requiredProfileDiagnostic(
  member: EnsembleProfileDiagnosticMember,
  id: ProfileDiagnosticId,
): ProfileDiagnosticResult {
  const diagnostic = member.diagnostics.find((candidate) => candidate.id === id);
  if (!diagnostic) {
    throw new Error(`Ensemble profile diagnostic aggregation is missing ${id} for ${member.member}`);
  }
  return diagnostic;
}

function summarizeCrossingSelection(
  crossings: readonly { geopotentialHeightGpm: number; pressureHpa: number }[],
  quantiles: readonly number[],
) {
  return {
    contributingMemberCount: crossings.length,
    geopotentialHeightGpm: summarizeNumericDistribution(
      crossings.map((crossing) => crossing.geopotentialHeightGpm),
      quantiles,
    ),
    pressureHpa: summarizeNumericDistribution(crossings.map((crossing) => crossing.pressureHpa), quantiles),
  };
}

function conditionalDistribution(values: readonly number[], quantiles: readonly number[]) {
  return {
    contributingMemberCount: values.length,
    distribution: summarizeNumericDistribution(values, quantiles),
  };
}

function minimumByHeight<T extends { geopotentialHeightGpm: number }>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Cannot select a freezing crossing from an empty list");
  return values.reduce(
    (best, candidate) => candidate.geopotentialHeightGpm < best.geopotentialHeightGpm ? candidate : best,
    first,
  );
}

function maximumByHeight<T extends { geopotentialHeightGpm: number }>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Cannot select a freezing crossing from an empty list");
  return values.reduce(
    (best, candidate) => candidate.geopotentialHeightGpm > best.geopotentialHeightGpm ? candidate : best,
    first,
  );
}

function summarizeBoundary(
  boundaries: readonly ({ pressureHpa: number; geopotentialHeightGpm?: number } | undefined)[],
  memberCount: number,
  quantiles: readonly number[],
) {
  const present = boundaries.filter(
    (boundary): boundary is { pressureHpa: number; geopotentialHeightGpm?: number } => boundary !== undefined,
  );
  const heights = present
    .map((boundary) => boundary.geopotentialHeightGpm)
    .filter((value): value is number => value !== undefined);
  return {
    membersWithBoundary: rawMemberEventFraction(present.length, memberCount),
    ...(present.length === 0
      ? {}
      : {
          pressureHpa: summarizeNumericDistribution(present.map((boundary) => boundary.pressureHpa), quantiles),
        }),
    ...(heights.length === present.length && heights.length > 0
      ? {
          geopotentialHeightGpm: summarizeNumericDistribution(heights, quantiles),
        }
      : {}),
  };
}
