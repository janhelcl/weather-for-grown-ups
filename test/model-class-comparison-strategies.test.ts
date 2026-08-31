import { describe, expect, it, vi } from "vitest";
import {
  AigfsAifsComparisonStrategy,
  GefsAigefsComparisonStrategy,
  GfsAigfsComparisonStrategy,
  HgefsAigefsComparisonStrategy,
  HgefsGefsComparisonStrategy,
  IfsAifsComparisonStrategy,
  IfsEnsAifsEnsComparisonStrategy,
} from "../src/core/comparison-strategies/strategies.js";
import { compareAtmosphericDatasetsSchema } from "../src/schema/unified-specialized.js";

const base = {
  geometry: { type: "point" as const, latitude: 50, longitude: 14 },
  time: { at: "2026-08-31T06:00:00.000Z" },
  run: "2026-08-31T00:00:00.000Z",
  variable: "temperature",
  pressureLevelHpa: 850,
};

function fakeService() {
  return {
    compareDeterministic: vi.fn(async (input: unknown) => ({ kind: "deterministic", input })),
    compareEnsembles: vi.fn(async (input: unknown) => ({ kind: "ensemble", input })),
    compareHybridConstituent: vi.fn(async (input: unknown) => ({ kind: "hybrid", input })),
  };
}

describe("AI/hybrid comparison strategies", () => {
  it("routes all deterministic model-class pairs through the normalized deterministic mechanic", async () => {
    const service = fakeService();

    await new GfsAigfsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({
        ...base,
        datasets: ["gfs", "aigfs"],
        gfsGrid: "0p25",
      }),
    );
    await new IfsAifsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({ ...base, datasets: ["ifs", "aifs"] }),
    );
    await new AigfsAifsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({ ...base, datasets: ["aigfs", "aifs"] }),
    );

    expect(service.compareDeterministic).toHaveBeenCalledTimes(3);
    expect(service.compareDeterministic.mock.calls[0]![0]).toMatchObject({
      datasets: ["gfs", "aigfs"],
      gfsGrid: "0p25",
    });
    expect(service.compareDeterministic.mock.calls[1]![0]).toMatchObject({
      datasets: ["ifs", "aifs"],
    });
    expect(service.compareDeterministic.mock.calls[2]![0]).toMatchObject({
      datasets: ["aigfs", "aifs"],
    });
  });

  it("routes independent ensemble pairs without member pairing", async () => {
    const service = fakeService();

    await new GefsAigefsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({
        ...base,
        datasets: ["gefs", "aigefs"],
        gefsMembers: ["c00", "p01"],
        aigefsMembers: ["c00", "p01"],
        quantiles: [0.5],
        thresholdGte: 10,
      }),
    );
    await new IfsEnsAifsEnsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({
        ...base,
        datasets: ["ifs-ens", "aifs-ens"],
        ifsEnsMembers: ["p01", "p02"],
        aifsEnsMembers: ["c00", "p01"],
        quantiles: [0.5],
      }),
    );

    expect(service.compareEnsembles).toHaveBeenCalledTimes(2);
    expect(service.compareEnsembles.mock.calls[0]![0]).toMatchObject({
      datasets: ["gefs", "aigefs"],
      leftMembers: ["c00", "p01"],
      rightMembers: ["c00", "p01"],
      thresholdGte: 10,
    });
    expect(service.compareEnsembles.mock.calls[1]![0]).toMatchObject({
      datasets: ["ifs-ens", "aifs-ens"],
      leftMembers: ["p01", "p02"],
      rightMembers: ["c00", "p01"],
    });
  });

  it("routes HGEFS comparisons through explicit overlapping constituent semantics", async () => {
    const service = fakeService();
    const members = ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"];

    await new HgefsGefsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({
        ...base,
        datasets: ["hgefs", "gefs"],
        hgefsMembers: members,
        quantiles: [0.5],
      }),
    );
    await new HgefsAigefsComparisonStrategy(service).compare(
      compareAtmosphericDatasetsSchema.parse({
        ...base,
        datasets: ["hgefs", "aigefs"],
        hgefsMembers: members,
        quantiles: [0.5],
        thresholdGte: 12,
      }),
    );

    expect(service.compareHybridConstituent).toHaveBeenCalledTimes(2);
    expect(service.compareHybridConstituent.mock.calls[0]![0]).toMatchObject({
      constituent: "gefs",
      members,
    });
    expect(service.compareHybridConstituent.mock.calls[1]![0]).toMatchObject({
      constituent: "aigefs",
      members,
      thresholdGte: 12,
    });
  });

  it("keeps each strategy pair-specific even when handed another valid comparison request", async () => {
    const service = fakeService();
    const wrong = compareAtmosphericDatasetsSchema.parse({
      ...base,
      datasets: ["ifs", "aifs"],
    });

    expect(() => new GfsAigfsComparisonStrategy(service).compare(wrong))
      .toThrow("requires datasets=gfs,aigfs");
    expect(service.compareDeterministic).not.toHaveBeenCalled();
  });
});
