import { describe, expect, it, vi } from "vitest";
import {
  ModelClassComparisonService,
  type ModelClassComparisonQueryService,
} from "../src/core/model-class-comparison.js";
import type { QueryAtmosphereInput } from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";

function wrapped(dataset: string, result: unknown): any {
  return {
    dataset,
    internalDatasetId: "gfs_0p25",
    role: "forecast",
    kind: dataset.includes("ens") || dataset === "gefs" || dataset === "aigefs"
      ? "ensemble"
      : "deterministic",
    geometryType: "point",
    timeType: "instant",
    result,
  };
}

function deterministicResult(
  model: string,
  resolvedRun: string,
  temperatureC: number,
  provider: string,
) {
  return {
    model,
    run: resolvedRun,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    levels: [{ pressureHpa: 850, temperatureC }],
    source: { provider, cacheHit: true },
  };
}

function distribution(values: readonly number[], quantiles = [0.1, 0.5, 0.9]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    memberCount: sorted.length,
    mean,
    populationStdDev: Math.sqrt(variance),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    quantiles: quantiles.map((quantile) => ({
      quantile,
      value: quantile === 0.5
        ? sorted[Math.floor((sorted.length - 1) / 2)]!
        : quantile < 0.5 ? sorted[0]! : sorted[sorted.length - 1]!,
    })),
  };
}

function aiEnsembleResult(
  model: string,
  values: readonly number[],
  members: readonly string[],
  provider: string,
) {
  return {
    model,
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      pressureLevelHpa: 850,
      field: "temperatureC",
      aggregation: "numeric_distribution",
      distribution: distribution(values),
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      levels: [{ pressureHpa: 850, temperatureC: values[index % values.length]! }],
    })),
    source: { provider, allCacheHit: true },
  };
}

function gefsEnsembleResult(
  values: readonly number[],
  members: readonly string[],
) {
  return {
    model: "gefs_0p50",
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputField: "temperatureC",
      unit: "degC",
      distribution: distribution(values),
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      pressureValues: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        value: values[index % values.length]!,
      }],
      fields: [],
    })),
    source: { provider: "NOAA AWS Open Data", allCacheHit: true },
  };
}

function ifsEnsResult(
  values: readonly number[],
  members: readonly string[],
) {
  return {
    model: "ifs_ens_0p25",
    run,
    validTime,
    forecastHour: 6,
    requestedPoint: { latitude: 50, longitude: 14 },
    gridPoint: { latitude: 50, longitude: 14 },
    pressureSummaries: [{
      variable: "temperature",
      pressureLevelHpa: 850,
      outputs: [{
        field: "temperatureC",
        unit: "degC",
        aggregation: "numeric_distribution",
        distribution: distribution(values),
      }],
    }],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      pressureValues: [{
        variable: "temperature",
        pressureLevelHpa: 850,
        values: { temperatureC: values[index % values.length]! },
      }],
      fields: [],
    })),
    source: { provider: "ECMWF Open Data", allCacheHit: true },
  };
}

describe("model-class comparison mechanics", () => {
  it("aligns latest deterministic physics and AI forecasts onto one shared cycle", async () => {
    const calls: QueryAtmosphereInput[] = [];
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        calls.push(input);
        const requestedRun = input.forecast?.run ?? "latest";
        if (input.dataset === "gfs") {
          const resolved = requestedRun === "latest"
            ? "2026-08-31T12:00:00.000Z"
            : String(requestedRun);
          return wrapped("gfs", deterministicResult("gfs_0p25", resolved, 10, "NOAA"));
        }
        const resolved = requestedRun === "latest"
          ? "2026-08-31T06:00:00.000Z"
          : String(requestedRun);
        return wrapped(
          "aigfs",
          deterministicResult("aigfs_0p25", resolved, 12, "NOAA NOMADS"),
        );
      }),
    } satisfies ModelClassComparisonQueryService);

    const result: any = await service.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run: "latest",
      variable: "temperature",
      pressureLevelHpa: 850,
    });

    expect(result.run).toBe("2026-08-31T06:00:00.000Z");
    expect(result.comparison.outputs[0]).toMatchObject({
      field: "temperatureC",
      leftValue: 10,
      rightValue: 12,
      rightMinusLeft: 2,
      deltaKind: "linear",
    });
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) =>
      call.dataset === "gfs" && call.forecast?.run === "2026-08-31T06:00:00.000Z"
    )).toHaveLength(1);
  });

  it("preserves native IFS ENS and AIFS ENS populations instead of forcing symmetry", async () => {
    const calls: QueryAtmosphereInput[] = [];
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        calls.push(input);
        const members = input.ensemble?.members ?? [];
        const values = members.map((_, index) => 5 + index / 10);
        return wrapped(
          input.dataset,
          input.dataset === "ifs-ens"
            ? ifsEnsResult(values, members)
            : aiEnsembleResult("aifs_ens_0p25", values, members, "ECMWF Open Data"),
        );
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareEnsembles({
      datasets: ["ifs-ens", "aifs-ens"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 7,
    });

    const ifsMembers = calls.find((call) => call.dataset === "ifs-ens")!.ensemble!.members!;
    const aifsMembers = calls.find((call) => call.dataset === "aifs-ens")!.ensemble!.members!;
    expect(ifsMembers).toHaveLength(50);
    expect(ifsMembers[0]).toBe("p01");
    expect(ifsMembers).not.toContain("c00");
    expect(aifsMembers).toHaveLength(51);
    expect(aifsMembers[0]).toBe("c00");
    expect(result.left.memberCount).toBe(50);
    expect(result.right.memberCount).toBe(51);
    expect(result.comparison.interpretation).toBe(
      "independent_raw_ensemble_distributions_no_member_pairing_not_calibrated_uncertainty",
    );
  });

  it("compares GEFS and AIGEFS as independent distributions with raw threshold fractions", async () => {
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const members = input.ensemble?.members ?? [];
        const values = input.dataset === "gefs" ? [8, 10, 12] : [10, 12, 14];
        return wrapped(
          input.dataset,
          input.dataset === "gefs"
            ? gefsEnsembleResult(values, members)
            : aiEnsembleResult("aigefs_0p25", values, members, "NOAA"),
        );
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01", "p02"],
      rightMembers: ["c00", "p01", "p02"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 11,
    });

    expect(result.comparison.rightMinusLeftMean).toBe(2);
    expect(result.comparison.threshold).toMatchObject({
      leftCount: 1,
      leftFraction: 1 / 3,
      rightCount: 2,
      rightFraction: 2 / 3,
      rightMinusLeftFraction: 1 / 3,
      interpretation: "raw_member_fractions_not_calibrated_probabilities",
    });
  });

  it("compares HGEFS with a constituent from the same hybrid payload and marks the overlap", async () => {
    const fake: ModelClassComparisonQueryService = {
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        expect(input.dataset).toBe("hgefs");
        return wrapped("hgefs", {
          model: "hgefs_0p25",
          run,
          validTime,
          forecastHour: 6,
          constituentGridPoints: [
            { population: "gefs", gridPoint: { latitude: 50, longitude: 14 } },
            { population: "aigefs", gridPoint: { latitude: 50, longitude: 14.25 } },
          ],
          members: [
            {
              member: "gefs:c00",
              population: "gefs",
              levels: [{ pressureHpa: 850, temperatureC: 10 }],
            },
            {
              member: "gefs:p01",
              population: "gefs",
              levels: [{ pressureHpa: 850, temperatureC: 12 }],
            },
            {
              member: "aigefs:c00",
              population: "aigefs",
              levels: [{ pressureHpa: 850, temperatureC: 14 }],
            },
            {
              member: "aigefs:p01",
              population: "aigefs",
              levels: [{ pressureHpa: 850, temperatureC: 16 }],
            },
          ],
          source: {
            provider: "NOAA",
            constituents: [
              { population: "gefs", source: { provider: "NOAA AWS Open Data" } },
              { population: "aigefs", source: { provider: "NOAA EAGLE AWS Open Data" } },
            ],
          },
        });
      }),
    };
    const service = new ModelClassComparisonService(fake);

    const result: any = await service.compareHybridConstituent({
      constituent: "gefs",
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 13,
    });

    expect(result.hgefs.summary.mean).toBe(13);
    expect(result.constituent.summary.mean).toBe(11);
    expect(result.comparison.constituentMinusHybridMean).toBe(-2);
    expect(result.comparison.interpretation).toBe(
      "overlapping_hybrid_and_constituent_raw_distributions_not_independent_not_calibrated_uncertainty",
    );
    expect(result.constituent.source).toEqual({ provider: "NOAA AWS Open Data" });
    expect(result.comparison.threshold).toMatchObject({
      leftLabel: "hybrid",
      rightLabel: "gefs",
      leftCount: 2,
      leftFraction: 0.5,
      rightCount: 0,
      rightFraction: 0,
      rightMinusLeftFraction: -0.5,
    });
  });

  it("uses linear wind-speed deltas and shortest signed circular direction deltas", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => wrapped(input.dataset, {
        model: input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
        run,
        validTime,
        forecastHour: 6,
        gridPoint: { latitude: 50, longitude: 14 },
        levels: [{
          pressureHpa: 850,
          windSpeedMs: input.dataset === "gfs" ? 8 : 10,
          windDirectionDeg: input.dataset === "gfs" ? 350 : 10,
        }],
        source: { provider: "NOAA" },
      })),
    });

    const result: any = await service.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "wind",
      pressureLevelHpa: 850,
    });

    expect(result.comparison.outputs).toEqual([
      expect.objectContaining({
        field: "windSpeedMs",
        rightMinusLeft: 2,
        deltaKind: "linear",
      }),
      expect.objectContaining({
        field: "windDirectionDeg",
        rightMinusLeft: 20,
        deltaKind: "circular_degrees",
      }),
    ]);
  });

  it("rejects inconsistent initialization and valid-time semantics defensively", async () => {
    const wrongRun = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => wrapped(
        input.dataset,
        deterministicResult(
          input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
          input.dataset === "gfs" ? run : "2026-08-31T06:00:00.000Z",
          10,
          "NOAA",
        ),
      )),
    });
    await expect(wrongRun.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("inconsistent initialization cycles");

    const wrongForecastHour = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const result = deterministicResult(
          input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
          run,
          10,
          "NOAA",
        );
        if (input.dataset === "aigfs") result.forecastHour = 12;
        return wrapped(input.dataset, result);
      }),
    });
    await expect(wrongForecastHour.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("inconsistent valid-time semantics");
  });


  it("resolves canonical GEFS/AIGEFS defaults and rejects ensemble use on deterministic datasets", async () => {
    const calls: QueryAtmosphereInput[] = [];
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        calls.push(input);
        const members = input.ensemble?.members ?? [];
        const values = members.map((_, index) => 10 + index / 10);
        return wrapped(
          input.dataset,
          input.dataset === "gefs"
            ? gefsEnsembleResult(values, members)
            : aiEnsembleResult("aigefs_0p25", values, members, "NOAA"),
        );
      }),
    });

    const result: any = await service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      quantiles: [0.5],
    });
    expect(calls.find((call) => call.dataset === "gefs")!.ensemble!.members).toHaveLength(31);
    expect(calls.find((call) => call.dataset === "aigefs")!.ensemble!.members).toHaveLength(31);
    expect(result.left.memberCount).toBe(31);
    expect(result.right.memberCount).toBe(31);

    await expect(service.compareEnsembles({
      datasets: ["gfs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      quantiles: [0.5],
    })).rejects.toThrow("does not have an ensemble comparison population");
  });

  it("fails clearly when a requested ensemble quantile is absent", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const members = input.ensemble?.members ?? ["c00", "p01"];
        const result = input.dataset === "gefs"
          ? gefsEnsembleResult([10, 12], members)
          : aiEnsembleResult("aigefs_0p25", [11, 13], members, "NOAA");
        result.pressureSummaries[0]!.distribution.quantiles = [{ quantile: 0.5, value: 11 }];
        return wrapped(input.dataset, result);
      }),
    });

    await expect(service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.9],
    })).rejects.toThrow("missing quantile 0.9");
  });

  it("allows missing hybrid constituent provenance without fabricating a source", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async () => wrapped("hgefs", {
        model: "hgefs_0p25",
        run,
        validTime,
        forecastHour: 6,
        members: [
          { member: "gefs:c00", population: "gefs", levels: [{ pressureHpa: 850, temperatureC: 10 }] },
          { member: "gefs:p01", population: "gefs", levels: [{ pressureHpa: 850, temperatureC: 12 }] },
          { member: "aigefs:c00", population: "aigefs", levels: [{ pressureHpa: 850, temperatureC: 14 }] },
          { member: "aigefs:p01", population: "aigefs", levels: [{ pressureHpa: 850, temperatureC: 16 }] },
        ],
        source: { provider: "NOAA" },
      })),
    });

    const result: any = await service.compareHybridConstituent({
      constituent: "aigefs",
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      quantiles: [0.5],
    });
    expect(result.constituent.source).toBeUndefined();
  });

  it("guards required numeric comparison metadata", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const result: any = deterministicResult(
          input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
          run,
          10,
          "NOAA",
        );
        delete result.forecastHour;
        return wrapped(input.dataset, result);
      }),
    });

    await expect(service.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("missing numeric comparison forecastHour");
  });


  it("guards required string and profile-array comparison metadata", async () => {
    const missingRun = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const result: any = deterministicResult(
          input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
          run,
          10,
          "NOAA",
        );
        delete result.run;
        return wrapped(input.dataset, result);
      }),
    });
    await expect(missingRun.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("missing comparison run");

    const missingLevels = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const result: any = deterministicResult(
          input.dataset === "gfs" ? "gfs_0p25" : "aigfs_0p25",
          run,
          10,
          "NOAA",
        );
        delete result.levels;
        return wrapped(input.dataset, result);
      }),
    });
    await expect(missingLevels.compareDeterministic({
      datasets: ["gfs", "aigfs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
    })).rejects.toThrow("profile levels");
  });


  it("rejects malformed ensemble member payloads missing selected pressure values", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const members = input.ensemble?.members ?? ["c00", "p01"];
        const result: any = input.dataset === "gefs"
          ? gefsEnsembleResult([10, 12], members)
          : aiEnsembleResult("aigefs_0p25", [11, 13], members, "NOAA");
        if (input.dataset === "gefs") result.members[0].pressureValues = [];
        return wrapped(input.dataset, result);
      }),
    });

    await expect(service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.5],
      thresholdGte: 10,
    })).rejects.toThrow("member is missing temperature@850hPa");
  });

  it("rejects malformed hybrid member payloads missing the selected profile level", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async () => wrapped("hgefs", {
        model: "hgefs_0p25",
        run,
        validTime,
        forecastHour: 6,
        members: [
          { member: "gefs:c00", population: "gefs", levels: [{ pressureHpa: 700, temperatureC: 10 }] },
          { member: "gefs:p01", population: "gefs", levels: [{ pressureHpa: 850, temperatureC: 12 }] },
          { member: "aigefs:c00", population: "aigefs", levels: [{ pressureHpa: 850, temperatureC: 14 }] },
          { member: "aigefs:p01", population: "aigefs", levels: [{ pressureHpa: 850, temperatureC: 16 }] },
        ],
        source: { provider: "NOAA" },
      })),
    });

    await expect(service.compareHybridConstituent({
      constituent: "gefs",
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      quantiles: [0.5],
    })).rejects.toThrow("member is missing 850 hPa");
  });

  it("handles zero-spread reference ensembles and rejects non-scalar ensemble variables", async () => {
    const service = new ModelClassComparisonService({
      query: vi.fn(async (input: QueryAtmosphereInput) => {
        const members = input.ensemble?.members ?? ["c00", "p01"];
        const values = input.dataset === "gefs" ? [10, 10] : [9, 11];
        return wrapped(
          input.dataset,
          input.dataset === "gefs"
            ? gefsEnsembleResult(values, members)
            : aiEnsembleResult("aigefs_0p25", values, members, "NOAA"),
        );
      }),
    });

    const result: any = await service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "temperature",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.5],
    });
    expect(result.comparison.populationStdDevRatioRightToLeft).toBeNull();

    await expect(service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "wind",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("requires one scalar output");

    await expect(service.compareEnsembles({
      datasets: ["gefs", "aigefs"],
      latitude: 50,
      longitude: 14,
      validTime,
      run,
      variable: "not_a_variable",
      pressureLevelHpa: 850,
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      quantiles: [0.5],
    })).rejects.toThrow("Unknown comparison variable");
  });
});
