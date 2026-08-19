import { describe, expect, it } from "vitest";
import {
  expandRequestedVariables,
  SUPPORTED_GFS_CODES,
  VARIABLE_CATALOG,
} from "../src/catalog/variables.js";

describe("variable catalog", () => {
  it("maps raw public variables to GFS codes, source units, and output fields", () => {
    expect(VARIABLE_CATALOG.temperature).toMatchObject({
      kind: "raw", gfsCode: "TMP", sourceUnit: "K",
      outputs: [{ field: "temperatureC", unit: "degC" }],
    });
    expect(VARIABLE_CATALOG.geopotential_height).toMatchObject({
      kind: "raw", gfsCode: "HGT", sourceUnit: "gpm",
      outputs: [{ field: "geopotentialHeightGpm", unit: "gpm" }],
    });
    expect(VARIABLE_CATALOG.vertical_velocity).toMatchObject({
      kind: "raw", gfsCode: "VVEL", sourceUnit: "Pa/s",
      outputs: [{ field: "verticalVelocityPaS", unit: "Pa/s" }],
    });
  });

  it("keeps the raw decoder code list aligned with the raw catalog", () => {
    const catalogCodes = Object.values(VARIABLE_CATALOG)
      .filter((definition) => definition.kind === "raw")
      .map((definition) => definition.gfsCode)
      .sort();
    expect([...SUPPORTED_GFS_CODES].sort()).toEqual(catalogCodes);
  });

  it("describes wind as a derived isobaric variable with U/V dependencies and two outputs", () => {
    expect(VARIABLE_CATALOG.wind).toEqual({
      id: "wind",
      kind: "derived",
      levelType: "isobaric_hpa",
      dependencies: ["u_wind", "v_wind"],
      description: "Wind speed and meteorological direction derived from U/V components",
      outputs: [
        { field: "windSpeedMs", unit: "m/s", description: "Wind speed" },
        { field: "windDirectionDeg", unit: "degree", description: "Meteorological wind direction" },
      ],
    });
  });
});

describe("expandRequestedVariables", () => {
  it("returns a raw variable unchanged", () => {
    expect(expandRequestedVariables(["specific_humidity"]).map((variable) => variable.id)).toEqual(["specific_humidity"]);
  });

  it("expands derived wind to U and V components", () => {
    expect(expandRequestedVariables(["wind"]).map((variable) => variable.id)).toEqual(["u_wind", "v_wind"]);
  });

  it("deduplicates raw variables and derived dependencies", () => {
    expect(
      expandRequestedVariables(["temperature", "wind", "u_wind", "temperature", "wind"]).map(
        (variable) => variable.id,
      ),
    ).toEqual(["temperature", "u_wind", "v_wind"]);
  });

  it("never returns derived definitions to the NOAA source layer", () => {
    expect(expandRequestedVariables(["wind", "absolute_vorticity"]).every((variable) => variable.kind === "raw")).toBe(true);
  });
});
