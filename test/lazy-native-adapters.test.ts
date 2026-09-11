import { describe, expect, it, vi } from "vitest";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../src/schema/unified-api.js";

const datasets = [
  ["aigfs", "aigfs"], ["aigefs", "aigefs"], ["aifs", "aifs"],
  ["aifs-ens", "aifsEns"], ["hgefs", "hgefs"], ["icon-d2", "iconD2"],
  ["icon-d2-eps", "iconD2Eps"], ["arome", "arome"], ["pe-arome", "peArome"],
] as const;

describe("native services behind lazy dataset adapters", () => {
  it.each(datasets)("preserves %s query injection and per-request execution", async (dataset, option) => {
    const request: QueryAtmosphereRequest = {
      dataset,
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-09-12T00:00:00Z" },
      selection: { fields: ["temperature_2m"] },
    };
    const query = vi.fn(async () => ({ evidence: dataset }));
    const registry = createAtmosphericQueryAdapterRegistry({ [option]: { query } });
    const results = await Promise.all([registry[dataset].query(request), registry[dataset].query(request)]);
    expect(results).toEqual([{ evidence: dataset }, { evidence: dataset }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(request);
  });

  it.each(datasets.slice(0, 7))("preserves %s diagnostic injection", async (dataset, option) => {
    const request = { dataset } as DiagnoseAtmosphereRequest;
    const diagnose = vi.fn(async () => ({ diagnostic: dataset }));
    const registry = createAtmosphericDiagnosticAdapterRegistry({ [`${option}Diagnostics`]: { diagnose } });
    expect(await registry[dataset].diagnose(request)).toEqual({ diagnostic: dataset });
    expect(diagnose).toHaveBeenCalledExactlyOnceWith(request);
  });

  it.each(["arome", "pe-arome"] as const)("retains %s field-only diagnostic rejection", async dataset => {
    await expect(createAtmosphericDiagnosticAdapterRegistry()[dataset].diagnose({ dataset } as DiagnoseAtmosphereRequest))
      .rejects.toThrow("pressure-based diagnostics");
  });
});
