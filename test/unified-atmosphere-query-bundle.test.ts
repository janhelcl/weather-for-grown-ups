import { describe, expect, it, vi } from "vitest";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";
import type {
  DiagnoseAtmosphereInput,
  UnifiedAtmosphereResult,
} from "../src/schema/unified-api.js";

function diagnosticResult(
  input: DiagnoseAtmosphereInput,
  result: unknown,
): UnifiedAtmosphereResult {
  return {
    dataset: input.dataset,
    internalDatasetId: "gfs_0p25",
    role: "forecast",
    kind: "deterministic",
    geometryType: "point",
    timeType: "instant",
    result,
  };
}

describe("unified atmospheric evidence bundles", () => {
  it("returns raw state and ordered derived diagnostics without flattening their semantics", async () => {
    const rawState = { model: "gfs_0p25", evidence: "raw-column" };
    const query = vi.fn(async () => rawState);
    const diagnose = vi.fn(async (input: DiagnoseAtmosphereInput) => diagnosticResult(
      input,
      { derivedFrom: input.diagnostic.kind },
    ));
    const service = new UnifiedAtmosphereQueryService({
      adapters: { gfs: { query } },
      diagnosticService: { diagnose },
    });
    const diagnostics = [
      {
        kind: "layer" as const,
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear" as const],
      },
      {
        kind: "profile" as const,
        pressureLevelsHpa: [1000, 850, 700, 500],
        diagnostics: ["freezing_level_crossings" as const],
      },
    ];

    const result = await service.query({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-10T12:00:00Z" },
      selection: {
        variables: ["temperature", "u_wind", "v_wind"],
        pressureLevelsHpa: [1000, 850, 700, 500],
        fields: ["temperature_2m"],
      },
      diagnostics,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(diagnose).toHaveBeenCalledTimes(2);
    expect(diagnose.mock.calls.map(([input]) => input.diagnostic)).toEqual(diagnostics);
    expect(result.result).toEqual({
      state: rawState,
      diagnostics: [
        { diagnostic: diagnostics[0], result: { derivedFrom: "layer" } },
        { diagnostic: diagnostics[1], result: { derivedFrom: "profile" } },
      ],
    });
  });

  it("preserves the ordinary raw-state result shape when no diagnostics are requested", async () => {
    const rawState = { model: "gfs_0p25", evidence: "raw-column" };
    const query = vi.fn(async () => rawState);
    const diagnose = vi.fn();
    const service = new UnifiedAtmosphereQueryService({
      adapters: { gfs: { query } },
      diagnosticService: { diagnose },
    });

    const result = await service.query({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-10T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
    });

    expect(result.result).toEqual(rawState);
    expect(diagnose).not.toHaveBeenCalled();
  });

  it("validates every bundled diagnostic before starting raw-state acquisition", async () => {
    const query = vi.fn(async () => ({ unreachable: true }));
    const diagnose = vi.fn();
    const service = new UnifiedAtmosphereQueryService({
      adapters: { gefs: { query } },
      diagnosticService: { diagnose },
    });

    await expect(service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-09-10T09:00:00Z",
        to: "2026-09-10T15:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      ensemble: { includeMembers: true },
      diagnostics: [{
        kind: "profile",
        pressureLevelsHpa: [1000, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      }],
    })).rejects.toThrow(/Ensemble diagnostic time series/);

    expect(query).not.toHaveBeenCalled();
    expect(diagnose).not.toHaveBeenCalled();
  });
});
