import { describe, expect, it, vi } from "vitest";
import { IFS_ENS_MEMBERS } from "../src/catalog/ifs-ens.js";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import { UnifiedAtmosphereDiagnosticService } from "../src/core/unified-atmosphere-api.js";
import { IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS } from "../src/schema/ifs-ens-diagnostic-timeseries.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const layerDiagnostic = {
  kind: "layer" as const,
  lowerPressureHpa: 850,
  upperPressureHpa: 500,
  diagnostics: ["wind_shear" as const],
};

describe("diagnostic adapter default ensemble controls", () => {
  it("keeps GEFS and IFS ENS ensemble controls optional for instant and range diagnostics", async () => {
    const layer = { getLayerDiagnostics: vi.fn(async (input) => input) };
    const timeSeries = { getDiagnosticTimeSeries: vi.fn(async (input) => input) };
    const ifsEns = {
      getLayerDiagnostics: vi.fn(async (input) => input),
      getProfileDiagnostics: vi.fn(),
      getParcelDiagnostics: vi.fn(),
    };
    const ifsEnsTimeSeries = { getDiagnosticTimeSeries: vi.fn(async (input) => input) };

    const service = new UnifiedAtmosphereDiagnosticService({
      adapters: createAtmosphericDiagnosticAdapterRegistry({
        layer: layer as any,
        timeSeries: timeSeries as any,
        ifsEns: ifsEns as any,
        ifsEnsTimeSeries: ifsEnsTimeSeries as any,
      }),
    });

    await service.diagnose({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: layerDiagnostic,
    });
    const gefsInstantQuery = layer.getLayerDiagnostics.mock.calls[0]![0].query;
    expect(gefsInstantQuery).not.toHaveProperty("members");
    expect(gefsInstantQuery).not.toHaveProperty("quantiles");
    expect(gefsInstantQuery).not.toHaveProperty("includeMembers");

    await service.diagnose({
      dataset: "gefs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
      },
      diagnostic: layerDiagnostic,
    });
    const gefsRangeQuery = timeSeries.getDiagnosticTimeSeries.mock.calls[0]![0].query;
    expect(gefsRangeQuery).not.toHaveProperty("members");
    expect(gefsRangeQuery).not.toHaveProperty("quantiles");
    expect(gefsRangeQuery).not.toHaveProperty("maxSteps");

    await service.diagnose({
      dataset: "ifs-ens",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: layerDiagnostic,
    });
    const ifsEnsInstant = ifsEns.getLayerDiagnostics.mock.calls[0]![0];
    expect(ifsEnsInstant).not.toHaveProperty("members");
    expect(ifsEnsInstant).not.toHaveProperty("quantiles");
    expect(ifsEnsInstant).not.toHaveProperty("includeMembers");

    await service.diagnose({
      dataset: "ifs-ens",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
      },
      diagnostic: layerDiagnostic,
    });
    const ifsEnsRange = ifsEnsTimeSeries.getDiagnosticTimeSeries.mock.calls[0]![0];
    expect(ifsEnsRange.members).toEqual([...IFS_ENS_MEMBERS]);
    expect(ifsEnsRange.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(ifsEnsRange.maxSteps).toBe(IFS_ENS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS);
  });
});
