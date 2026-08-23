import { describe, expect, it } from "vitest";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";
import {
  PARCEL_DEFINITION_IDS,
  PARCEL_DIAGNOSTIC_CATALOG,
} from "../src/catalog/parcel-diagnostics.js";

describe("parcel diagnostic catalog", () => {
  it("publishes the three explicit parcel definitions", () => {
    expect(PARCEL_DEFINITION_IDS).toEqual([
      "surface_2m",
      "mixed_layer_100hpa",
      "most_unstable_300hpa",
    ]);
    expect(Object.keys(PARCEL_DIAGNOSTIC_CATALOG)).toEqual([...PARCEL_DEFINITION_IDS]);
  });

  it("keeps pressure and surface dependencies explicit", () => {
    for (const definition of Object.values(PARCEL_DIAGNOSTIC_CATALOG)) {
      expect(definition.pressureDependencies).toEqual(["temperature", "specific_humidity", "geopotential_height"]);
      expect(definition.fieldDependencies).toEqual([
        "surface_pressure",
        "surface_geopotential_height",
        "temperature_2m",
        "specific_humidity_2m",
      ]);
    }
  });

  it("exposes parcel definitions through the agent catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.parcelDefinitions.map((definition) => definition.id)).toEqual([...PARCEL_DEFINITION_IDS]);
    expect(catalog.parcelDiagnosticsNote).toMatch(/pseudo-adiabatic/);
    expect(catalog.parcelDefinitions.find((definition) => definition.id === "mixed_layer_100hpa")).toMatchObject({
      kind: "derived_parcel",
      pressureDependencies: ["temperature", "specific_humidity", "geopotential_height"],
    });
  });
});
