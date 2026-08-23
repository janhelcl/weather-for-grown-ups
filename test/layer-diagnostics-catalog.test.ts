import { describe, expect, it } from "vitest";
import {
  expandLayerDiagnosticVariables,
  LAYER_DIAGNOSTIC_CATALOG,
  LAYER_DIAGNOSTIC_IDS,
} from "../src/catalog/layer-diagnostics.js";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";

describe("pressure-layer diagnostic catalog", () => {
  it("publishes three deterministic pressure-layer diagnostics", () => {
    expect(LAYER_DIAGNOSTIC_IDS).toEqual([
      "temperature_lapse_rate",
      "wind_shear",
      "potential_temperature_gradient",
    ]);
    expect(LAYER_DIAGNOSTIC_CATALOG.wind_shear).toMatchObject({
      kind: "derived_layer",
      verticalSemantics: "pressure_layer",
      dependencies: ["u_wind", "v_wind", "geopotential_height"],
    });
  });

  it("deduplicates raw dependencies across multiple diagnostics", () => {
    expect(expandLayerDiagnosticVariables([
      "temperature_lapse_rate",
      "wind_shear",
      "potential_temperature_gradient",
    ])).toEqual(["temperature", "geopotential_height", "u_wind", "v_wind"]);
  });

  it("exposes layer diagnostics through the agent-facing GFS catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.layerDiagnostics).toHaveLength(3);
    expect(catalog.layerDiagnostics.find((diagnostic) => diagnostic.id === "potential_temperature_gradient")).toMatchObject({
      dependencies: ["temperature", "geopotential_height"],
      outputs: [{ field: "potentialTemperatureGradientKPerKm", unit: "K/km" }],
    });
    expect(catalog.layerDiagnosticsNote).toMatch(/lowerPressureHpa must be greater than upperPressureHpa/);
  });
});
