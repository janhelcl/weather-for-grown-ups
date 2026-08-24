import { describe, expect, it, vi } from "vitest";
import type { GefsMemberSelectionSource } from "../src/cache/gefs-s3-subset-cache.js";
import { GefsEnsembleService, type GefsPointDecoder } from "../src/core/gefs-ensemble.js";

describe("GEFS raw non-isobaric ensemble", () => {
  it("summarizes a 2 m field member-first and normalizes temperature", async () => {
    const fieldSource: GefsMemberSelectionSource = {
      fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: request.member === "c00" })),
    };
    const decoder: GefsPointDecoder = {
      extractPoint: vi.fn(async (path) => [{
        code: "TMP",
        heightAboveGroundM: 2,
        value: path === "c00" ? 273.15 : 275.15,
        gridPoint: { latitude: 50, longitude: 14.5 },
      }]),
    };
    const service = new GefsEnsembleService({ fieldSource, decoder, concurrency: 1 });

    const result = await service.getEnsemble({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T03:00:00Z",
      field: "temperature_2m",
      members: ["c00", "p01"],
      quantiles: [0, 0.5, 1],
      thresholdGte: 1,
    });

    expect(fieldSource.fetchSelection).toHaveBeenCalledTimes(2);
    expect(result.selection).toMatchObject({
      field: "temperature_2m",
      gfsCode: "TMP",
      unit: "degC",
      vertical: { gribLevel: "2 m above ground" },
      temporal: { type: "instantaneous" },
    });
    expect(result.members.map((member) => member.value)).toEqual([0, 2]);
    expect(result.summary.mean).toBe(1);
    expect(result.summary.threshold).toMatchObject({ count: 1, fraction: 0.5, interpretation: "raw_member_fraction_not_calibrated_probability" });
    expect(result.source.allCacheHit).toBe(false);
  });

  it("preserves accumulation interval semantics in normalized output", async () => {
    const fieldSource: GefsMemberSelectionSource = {
      fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })),
    };
    const decoder: GefsPointDecoder = {
      extractPoint: vi.fn(async (path) => [{
        code: "APCP",
        surface: true,
        accumulation: { startForecastHour: 0, endForecastHour: 3 },
        value: path === "c00" ? 1 : 3,
        gridPoint: { latitude: 50, longitude: 14.5 },
      }]),
    };
    const service = new GefsEnsembleService({ fieldSource, decoder, concurrency: 1 });
    const result = await service.getEnsemble({
      latitude: 50,
      longitude: 14.5,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T03:00:00Z",
      field: "total_precipitation",
      members: ["c00", "p01"],
    });

    expect(result.selection.temporal).toEqual({
      type: "accumulation",
      startForecastHour: 0,
      endForecastHour: 3,
      startTime: "2026-08-24T00:00:00.000Z",
      endTime: "2026-08-24T03:00:00.000Z",
    });
    expect(result.summary.mean).toBe(2);
  });

  it("rejects temporal disagreement across members instead of mixing intervals", async () => {
    const fieldSource: GefsMemberSelectionSource = {
      fetchSelection: vi.fn(async (request) => ({ path: request.member, cacheHit: true })),
    };
    const decoder: GefsPointDecoder = {
      extractPoint: vi.fn(async (path) => [{
        code: "APCP",
        surface: true,
        accumulation: path === "c00"
          ? { startForecastHour: 0, endForecastHour: 3 }
          : { startForecastHour: 1, endForecastHour: 3 },
        value: 1,
        gridPoint: { latitude: 50, longitude: 14.5 },
      }]),
    };
    const service = new GefsEnsembleService({ fieldSource, decoder, concurrency: 1 });

    await expect(service.getEnsemble({
      latitude: 50,
      longitude: 14.5,
      run: "2026-08-24T00:00:00Z",
      validTime: "2026-08-24T03:00:00Z",
      field: "total_precipitation",
      members: ["c00", "p01"],
    })).rejects.toThrow("inconsistent temporal semantics");
  });
});
