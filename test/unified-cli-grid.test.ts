import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiagnostic,
  buildUnifiedQuery,
} from "../src/cli/unified-atmosphere-command.js";

describe("canonical CLI GFS grid mapping", () => {
  it("maps query --grid without requiring an explicit run", () => {
    const request = buildUnifiedQuery({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-27T12:00:00Z",
      vars: "temperature",
      levels: "850",
      grid: "0p50",
    });

    expect(request.forecast).toEqual({ grid: "0p50" });
  });

  it("maps diagnostic --grid together with an explicit run", () => {
    const request = buildUnifiedDiagnostic({
      dataset: "gfs",
      lat: 50,
      lon: 14,
      at: "2026-08-27T12:00:00Z",
      kind: "layer",
      lower: 850,
      upper: 700,
      diagnostics: "temperature_lapse_rate",
      levels: "850,700",
      grid: "0p50",
      run: "2026-08-27T00:00:00Z",
    });

    expect(request.forecast).toEqual({
      run: "2026-08-27T00:00:00Z",
      grid: "0p50",
    });
  });

  it("does not attach forecast controls to historical analysis", () => {
    const request = buildUnifiedQuery({
      dataset: "gfs-analysis",
      lat: 50,
      lon: 14,
      at: "2026-08-27T12:00:00Z",
      vars: "temperature",
      levels: "850",
      grid: "0p50",
    });

    expect(request.forecast).toBeUndefined();
  });
});
