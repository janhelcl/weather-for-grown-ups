import { describe, expect, it, vi } from "vitest";
import { AtmosphericOutOfDomainError } from "../src/core/atmospheric-domain.js";
import {
  GfsIconD2ComparisonStrategy,
  IfsAromeComparisonStrategy,
  IfsEnsIconD2EpsComparisonStrategy,
  IfsEnsPeAromeComparisonStrategy,
  IfsIconD2ComparisonStrategy,
} from "../src/core/comparison-strategies/strategies.js";
import { CrossScaleComparisonService } from "../src/core/cross-scale-comparison.js";
import { PUBLIC_DATASET_METADATA } from "../src/schema/unified-api.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const geometry = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const run = "2026-09-01T00:00:00.000Z";
const validTime = "2026-09-01T06:00:00.000Z";

describe("cross-scale comparison schema", () => {
  it("accepts only declared deterministic pressure/field intersections", () => {
    expect(compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "icon-d2"],
      geometry,
      time: { at: validTime },
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toMatchObject({
      datasets: ["ifs", "icon-d2"],
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    expect(compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "arome"],
      geometry,
      time: { at: validTime },
      run,
      field: "wind_100m",
    })).toMatchObject({
      datasets: ["ifs", "arome"],
      field: "wind_100m",
    });

    expect(compareAtmosphericDatasetsSchema.parse({
      datasets: ["gfs", "icon-d2"],
      geometry,
      time: { at: "2026-09-01T01:00:00.000Z" },
      run,
      field: "mean_sea_level_pressure",
      gfsGrid: "0p50",
    })).toMatchObject({
      datasets: ["gfs", "icon-d2"],
      gfsGrid: "0p50",
    });
  });

  it("requires an explicit shared cycle and pair-native valid-time cadence", () => {
    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "icon-d2"],
      geometry,
      time: { at: validTime },
      run: "latest",
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow();

    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "arome"],
      geometry,
      time: { at: "2026-09-01T01:00:00.000Z" },
      run,
      field: "temperature_2m",
    })).toThrow("shared 3-hour output cadence");

    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "icon-d2"],
      geometry,
      time: { at: "2026-09-03T03:00:00.000Z" },
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).toThrow("f000 through f048");
  });

  it("keeps ensemble comparison scalar and member-first", () => {
    const icon = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs-ens", "icon-d2-eps"],
      geometry,
      time: { at: validTime },
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      ifsEnsMembers: ["p01", "p02"],
      iconD2EpsMembers: ["p01", "p02"],
      quantiles: [0.25, 0.5, 0.75],
      thresholdGte: 0,
    });
    expect(icon).toMatchObject({
      datasets: ["ifs-ens", "icon-d2-eps"],
      ifsEnsMembers: ["p01", "p02"],
      iconD2EpsMembers: ["p01", "p02"],
    });

    const pe = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs-ens", "pe-arome"],
      geometry,
      time: { at: validTime },
      run,
      field: "relative_humidity_2m",
      ifsEnsMembers: ["p01", "p02"],
      peAromeMembers: ["c00", "p01"],
    });
    expect(pe).toMatchObject({
      datasets: ["ifs-ens", "pe-arome"],
      field: "relative_humidity_2m",
    });

    expect(() => compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs-ens", "icon-d2-eps"],
      geometry,
      time: { at: validTime },
      run,
      variable: "wind",
      pressureLevelHpa: 850,
    })).toThrow();
  });
});

describe("cross-scale comparison strategies", () => {
  function fakeMechanics() {
    return {
      compareDeterministic: vi.fn(async (input: unknown) => input),
      compareEnsembles: vi.fn(async (input: unknown) => input),
    };
  }

  it("rejects requests routed to the wrong pair instead of falling back generically", async () => {
    const mechanics = fakeMechanics();
    const ifsArome = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "arome"],
      geometry,
      time: { at: validTime },
      run,
      field: "temperature_2m",
    });
    const ifsIcon = compareAtmosphericDatasetsSchema.parse({
      datasets: ["ifs", "icon-d2"],
      geometry,
      time: { at: validTime },
      run,
      field: "temperature_2m",
    });

    expect(() =>
      new IfsIconD2ComparisonStrategy(mechanics as any).compare(ifsArome)
    ).toThrow("requires datasets=ifs,icon-d2");
    expect(() =>
      new IfsAromeComparisonStrategy(mechanics as any).compare(ifsIcon)
    ).toThrow("requires datasets=ifs,arome");
    expect(() =>
      new GfsIconD2ComparisonStrategy(mechanics as any).compare(ifsIcon)
    ).toThrow("requires datasets=gfs,icon-d2");
    expect(() =>
      new IfsEnsIconD2EpsComparisonStrategy(mechanics as any).compare(ifsIcon)
    ).toThrow("requires datasets=ifs-ens,icon-d2-eps");
    expect(() =>
      new IfsEnsPeAromeComparisonStrategy(mechanics as any).compare(ifsIcon)
    ).toThrow("requires datasets=ifs-ens,pe-arome");

    expect(mechanics.compareDeterministic).not.toHaveBeenCalled();
    expect(mechanics.compareEnsembles).not.toHaveBeenCalled();
  });

  it("rejects a correctly routed request that has no declared selection", async () => {
    const mechanics = fakeMechanics();
    const malformed = {
      datasets: ["ifs", "icon-d2"],
      geometry,
      time: { at: validTime },
      run,
    } as any;

    expect(() =>
      new IfsIconD2ComparisonStrategy(mechanics as any).compare(malformed)
    ).toThrow("missing its declared selection");
    expect(mechanics.compareDeterministic).not.toHaveBeenCalled();
  });

  it("routes all five declared pairs with pair-specific selection controls", async () => {
    const mechanics = fakeMechanics();

    await new IfsIconD2ComparisonStrategy(mechanics as any).compare(
      compareAtmosphericDatasetsSchema.parse({
        datasets: ["ifs", "icon-d2"],
        geometry,
        time: { at: validTime },
        run,
        variable: "temperature",
        pressureLevelHpa: 850,
      }),
    );
    await new IfsAromeComparisonStrategy(mechanics as any).compare(
      compareAtmosphericDatasetsSchema.parse({
        datasets: ["ifs", "arome"],
        geometry,
        time: { at: validTime },
        run,
        field: "temperature_2m",
      }),
    );
    await new GfsIconD2ComparisonStrategy(mechanics as any).compare(
      compareAtmosphericDatasetsSchema.parse({
        datasets: ["gfs", "icon-d2"],
        geometry,
        time: { at: validTime },
        run,
        field: "u_wind_10m",
        gfsGrid: "0p25",
      }),
    );
    await new IfsEnsIconD2EpsComparisonStrategy(mechanics as any).compare(
      compareAtmosphericDatasetsSchema.parse({
        datasets: ["ifs-ens", "icon-d2-eps"],
        geometry,
        time: { at: validTime },
        run,
        field: "temperature_2m",
        ifsEnsMembers: ["p01", "p02"],
        iconD2EpsMembers: ["p01", "p02"],
      }),
    );
    await new IfsEnsPeAromeComparisonStrategy(mechanics as any).compare(
      compareAtmosphericDatasetsSchema.parse({
        datasets: ["ifs-ens", "pe-arome"],
        geometry,
        time: { at: validTime },
        run,
        field: "temperature_2m",
        ifsEnsMembers: ["p01", "p02"],
        peAromeMembers: ["c00", "p01"],
      }),
    );

    expect(mechanics.compareDeterministic).toHaveBeenCalledTimes(3);
    expect(mechanics.compareEnsembles).toHaveBeenCalledTimes(2);
    expect(mechanics.compareDeterministic.mock.calls[0]![0]).toMatchObject({
      datasets: ["ifs", "icon-d2"],
      selection: { kind: "pressure", variable: "temperature", pressureLevelHpa: 850 },
    });
    expect(mechanics.compareDeterministic.mock.calls[2]![0]).toMatchObject({
      datasets: ["gfs", "icon-d2"],
      selection: { kind: "field", field: "u_wind_10m" },
      gfsGrid: "0p25",
    });
    expect(mechanics.compareEnsembles.mock.calls[0]![0]).toMatchObject({
      datasets: ["ifs-ens", "icon-d2-eps"],
      leftMembers: ["p01", "p02"],
      rightMembers: ["p01", "p02"],
    });
    expect(mechanics.compareEnsembles.mock.calls[1]![0]).toMatchObject({
      datasets: ["ifs-ens", "pe-arome"],
      rightMembers: ["c00", "p01"],
    });
  });
});

describe("cross-scale comparison mechanics", () => {
  it("compares deterministic fields without pretending the sampled grids are equal", async () => {
    const query = vi.fn(async (input: any) => {
      const value = input.dataset === "ifs" ? 10 : 12;
      return unified(input.dataset, {
        model: input.dataset,
        run,
        validTime,
        forecastHour: 6,
        gridPoint: input.dataset === "ifs"
          ? { latitude: 50, longitude: 14.5 }
          : { latitude: 50.08, longitude: 14.43 },
        fields: [{
          id: "temperature_2m",
          values: { temperatureC: value },
        }],
        source: { dataset: input.dataset },
      });
    });
    const service = new CrossScaleComparisonService({ query } as any);
    const result: any = await service.compareDeterministic({
      datasets: ["ifs", "arome"],
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      validTime,
      run,
      selection: { kind: "field", field: "temperature_2m" },
    });

    expect(result.comparison.outputs[0]).toMatchObject({
      field: "temperatureC",
      leftValue: 10,
      rightValue: 12,
      rightMinusLeft: 2,
    });
    expect(result.left.gridPoint).not.toEqual(result.right.gridPoint);
    expect(result.left.spatialContext.spatialDomain.scope).toBe("global");
    expect(result.right.spatialContext.spatialDomain.scope).toBe("limited_area");
    expect(result.alignment).toMatchObject({
      crossDatasetRegridding: "none",
      pointSampling: "each_dataset_samples_its_own_grid_at_the_same_requested_coordinate",
    });
  });

  it("compares independent field ensembles and threshold fractions without member pairing", async () => {
    const query = vi.fn(async (input: any) => {
      const left = input.dataset === "ifs-ens";
      const values = left ? [9, 11] : [11, 13];
      return unified(input.dataset, {
        model: input.dataset,
        run,
        validTime,
        forecastHour: 6,
        gridPoint: { latitude: 50.08, longitude: left ? 14.5 : 14.43 },
        fieldSummaries: [{
          field: "temperature_2m",
          outputs: [{
            field: "temperatureC",
            aggregation: "numeric_distribution",
            distribution: {
              memberCount: 2,
              mean: left ? 10 : 12,
              populationStdDev: 1,
              min: Math.min(...values),
              max: Math.max(...values),
              quantiles: [
                { quantile: 0.5, value: left ? 10 : 12 },
              ],
            },
          }],
        }],
        members: values.map((value, index) => ({
          member: `p0${index + 1}`,
          fields: [{
            ...(left ? { field: "temperature_2m" } : { id: "temperature_2m" }),
            values: { temperatureC: value },
          }],
        })),
        source: { dataset: input.dataset },
      });
    });
    const service = new CrossScaleComparisonService({ query } as any);
    const result: any = await service.compareEnsembles({
      datasets: ["ifs-ens", "pe-arome"],
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      validTime,
      run,
      selection: { kind: "field", field: "temperature_2m" },
      leftMembers: ["p01", "p02"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.5],
      thresholdGte: 10,
    });

    expect(result.comparison).toMatchObject({
      rightMinusLeftMean: 2,
      quantileShifts: [{ quantile: 0.5, leftValue: 10, rightValue: 12, rightMinusLeft: 2 }],
      threshold: {
        leftFraction: 0.5,
        rightFraction: 1,
        rightMinusLeftFraction: 0.5,
      },
    });
    expect(result.comparison.interpretation).toContain("no_member_pairing");
  });

  it("compares pressure-level vector wind with circular direction deltas", async () => {
    const query = vi.fn(async (input: any) => {
      const left = input.dataset === "ifs";
      return unified(input.dataset, {
        model: input.dataset,
        run,
        validTime,
        forecastHour: 6,
        gridPoint: left
          ? { latitude: 50, longitude: 14.5 }
          : { latitude: 50.08, longitude: 14.43 },
        levels: [{
          pressureHpa: 850,
          windSpeedMs: left ? 10 : 12,
          windDirectionDeg: left ? 350 : 10,
        }],
        source: { dataset: input.dataset },
      });
    });
    const service = new CrossScaleComparisonService({ query } as any);
    const result: any = await service.compareDeterministic({
      datasets: ["ifs", "icon-d2"],
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      validTime,
      run,
      selection: { kind: "pressure", variable: "wind", pressureLevelHpa: 850 },
    });

    expect(result.selection).toMatchObject({
      kind: "pressure",
      variable: "wind",
      pressureLevelHpa: 850,
    });
    expect(result.comparison.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "windSpeedMs",
        leftValue: 10,
        rightValue: 12,
        rightMinusLeft: 2,
        deltaKind: "linear",
      }),
      expect.objectContaining({
        field: "windDirectionDeg",
        leftValue: 350,
        rightValue: 10,
        rightMinusLeft: 20,
        deltaKind: "circular_degrees",
      }),
    ]));
  });

  it("uses native default ensemble populations for scalar pressure comparison without raw members", async () => {
    const query = vi.fn(async (input: any) => {
      const left = input.dataset === "ifs-ens";
      return unified(input.dataset, {
        model: input.dataset,
        run,
        validTime,
        forecastHour: 6,
        gridPoint: left
          ? { latitude: 50, longitude: 14.5 }
          : { latitude: 50.08, longitude: 14.43 },
        pressureSummaries: [{
          pressureLevelHpa: 850,
          variable: "temperature",
          distribution: {
            memberCount: input.ensemble.members.length,
            mean: left ? 5 : 6,
            populationStdDev: left ? 2 : 3,
            min: left ? 0 : 1,
            max: left ? 10 : 11,
            quantiles: [{ quantile: 0.5, value: left ? 5 : 6 }],
          },
        }],
        source: { dataset: input.dataset },
      });
    });
    const service = new CrossScaleComparisonService({ query } as any);
    const result: any = await service.compareEnsembles({
      datasets: ["ifs-ens", "icon-d2-eps"],
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      validTime,
      run,
      selection: { kind: "pressure", variable: "temperature", pressureLevelHpa: 850 },
      quantiles: [0.5],
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0].ensemble).toMatchObject({ members: expect.any(Array) });
    expect(query.mock.calls[0]![0].ensemble.members).toHaveLength(50);
    expect(query.mock.calls[1]![0].ensemble.members).toHaveLength(20);
    expect(query.mock.calls[0]![0].ensemble.includeMembers).toBeUndefined();
    expect(query.mock.calls[1]![0].ensemble.includeMembers).toBeUndefined();
    expect(result.comparison).toMatchObject({
      rightMinusLeftMean: 1,
      rightMinusLeftPopulationStdDev: 1,
      populationStdDevRatioRightToLeft: 1.5,
      quantileShifts: [{
        quantile: 0.5,
        leftValue: 5,
        rightValue: 6,
        rightMinusLeft: 1,
      }],
    });
    expect(result.comparison.threshold).toBeUndefined();
    expect(result.right.spatialContext.horizontalGridDegrees).toBeUndefined();
  });

  it("passes a requested GFS grid only to the GFS side", async () => {
    const query = vi.fn(async (input: any) => unified(input.dataset, {
      model: input.dataset,
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50.08, longitude: 14.43 },
      fields: [{
        id: "temperature_2m",
        values: { temperatureC: input.dataset === "gfs" ? 7 : 8 },
      }],
      source: { dataset: input.dataset },
    }));
    const service = new CrossScaleComparisonService({ query } as any);
    await service.compareDeterministic({
      datasets: ["gfs", "icon-d2"],
      latitude: geometry.latitude,
      longitude: geometry.longitude,
      validTime,
      run,
      selection: { kind: "field", field: "temperature_2m" },
      gfsGrid: "0p50",
    });

    expect(query.mock.calls[0]![0].forecast).toMatchObject({ run, grid: "0p50" });
    expect(query.mock.calls[1]![0].forecast).toEqual({ run });
  });

  it("rejects an out-of-domain point before any source query", async () => {
    const query = vi.fn();
    const service = new CrossScaleComparisonService({ query } as any);
    await expect(service.compareDeterministic({
      datasets: ["ifs", "arome"],
      latitude: 60,
      longitude: 14,
      validTime,
      run,
      selection: { kind: "field", field: "temperature_2m" },
    })).rejects.toBeInstanceOf(AtmosphericOutOfDomainError);
    expect(query).not.toHaveBeenCalled();
  });
});

function unified(dataset: keyof typeof PUBLIC_DATASET_METADATA, result: unknown) {
  const metadata = PUBLIC_DATASET_METADATA[dataset];
  return {
    dataset,
    internalDatasetId: metadata.internalDatasetId,
    role: metadata.role,
    kind: metadata.kind,
    geometryType: "point",
    timeType: "instant",
    result,
  } as any;
}
