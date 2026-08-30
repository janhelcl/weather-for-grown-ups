import { describe, expect, it, vi } from "vitest";
import { GfsAnalysisAnalogAdapter } from "../src/core/specialized-adapters/analogs.js";
import {
  GefsRunComparisonAdapter,
  GfsRunComparisonAdapter,
  IfsEnsRunComparisonAdapter,
  IfsRunComparisonAdapter,
} from "../src/core/specialized-adapters/run-comparison.js";
import {
  compareAtmosphericRunsSchema,
  findAtmosphericAnalogsSchema,
} from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("specialized run-comparison adapters", () => {
  it("translates deterministic GFS and IFS requests into native services", async () => {
    const gfsNative = { compareRuns: vi.fn(async (query) => ({ route: "gfs", query })) };
    const gfs = new GfsRunComparisonAdapter(gfsNative as any);
    const gfsRequest = compareAtmosphericRunsSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      gfsGrid: "0p50",
      cycles: 2,
    });
    await gfs.compare(gfsRequest);
    expect(gfsNative.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      fields: ["temperature_2m"],
      grid: "0p50",
      cycles: 2,
    }));

    const ifsNative = { compareRuns: vi.fn(async (query) => ({ route: "ifs", query })) };
    const ifs = new IfsRunComparisonAdapter(ifsNative as any);
    const ifsRequest = compareAtmosphericRunsSchema.parse({
      dataset: "ifs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850, 500],
      },
      anchorRun: "2026-08-28T00:00:00Z",
      cycles: 3,
    });
    await ifs.compare(ifsRequest);
    expect(ifsNative.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      anchorRun: "2026-08-28T00:00:00Z",
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850, 500],
      cycles: 3,
    }));
  });

  it("translates GEFS distribution controls without member-trajectory semantics", async () => {
    const native = { compareRuns: vi.fn(async (query) => ({ route: "gefs", query })) };
    const adapter = new GefsRunComparisonAdapter(native as any);
    const request = compareAtmosphericRunsSchema.parse({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      anchorRun: "latest",
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.1, 0.9],
      },
      thresholdGte: 5,
      cycles: 4,
    });
    await adapter.compare(request);
    expect(native.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["c00", "p01"],
      quantiles: [0.1, 0.9],
      thresholdGte: 5,
      cycles: 4,
    }));
  });

  it("translates IFS ENS distribution controls including cycle stride", async () => {
    const native = { compareRuns: vi.fn(async (query) => ({ route: "ifs-ens", query })) };
    const adapter = new IfsEnsRunComparisonAdapter(native as any);
    const request = compareAtmosphericRunsSchema.parse({
      dataset: "ifs-ens",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      ensemble: {
        members: ["p31", "p50"],
        quantiles: [0.1, 0.5, 0.9],
      },
      thresholdGte: 10,
      cycleStrideHours: 12,
      cycles: 3,
    });
    await adapter.compare(request);
    expect(native.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      members: ["p31", "p50"],
      quantiles: [0.1, 0.5, 0.9],
      thresholdGte: 10,
      cycleStrideHours: 12,
      cycles: 3,
    }));
  });

  it("guards adapter ownership explicitly", () => {
    const gfsRequest = compareAtmosphericRunsSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    const native = { compareRuns: vi.fn() };
    expect(() => new GefsRunComparisonAdapter(native as any).compare(gfsRequest))
      .toThrow("dataset=gefs");
    expect(() => new IfsRunComparisonAdapter(native as any).compare(gfsRequest))
      .toThrow("dataset=ifs");
    expect(() => new IfsEnsRunComparisonAdapter(native as any).compare(gfsRequest))
      .toThrow("dataset=ifs-ens");

    const ifsRequest = compareAtmosphericRunsSchema.parse({
      dataset: "ifs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(() => new GfsRunComparisonAdapter(native as any).compare(ifsRequest))
      .toThrow("dataset=gfs");
  });
});

describe("specialized analog adapter", () => {
  it("translates the common analysis request into the historical index service", async () => {
    const native = { findAnalogs: vi.fn(async (query) => ({ route: "analogs", query })) };
    const adapter = new GfsAnalysisAnalogAdapter(native as any);
    const request = findAtmosphericAnalogsSchema.parse({
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      count: 7,
      excludeWithinHours: 48,
      fetchTargetIfMissing: false,
    });
    const result = await adapter.find(request);
    expect((result as any).route).toBe("analogs");
    expect(native.findAnalogs).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: "2017-05-09T12:00:00Z",
      count: 7,
      excludeWithinHours: 48,
      fetchTargetIfMissing: false,
    }));
  });
});
