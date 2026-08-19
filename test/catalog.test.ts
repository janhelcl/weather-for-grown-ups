import { describe, expect, it } from "vitest";
import { expandRequestedVariables, VARIABLE_CATALOG } from "../src/catalog/variables.js";

describe("variable catalog", () => {
  it("maps raw public variables to GFS codes and units", () => {
    expect(VARIABLE_CATALOG.temperature).toMatchObject({ kind: "raw", gfsCode: "TMP", unit: "K" });
    expect(VARIABLE_CATALOG.relative_humidity).toMatchObject({ kind: "raw", gfsCode: "RH", unit: "%" });
    expect(VARIABLE_CATALOG.u_wind).toMatchObject({ kind: "raw", gfsCode: "UGRD", unit: "m/s" });
    expect(VARIABLE_CATALOG.v_wind).toMatchObject({ kind: "raw", gfsCode: "VGRD", unit: "m/s" });
  });

  it("describes wind as a derived variable with U/V dependencies", () => {
    expect(VARIABLE_CATALOG.wind).toEqual({
      id: "wind",
      kind: "derived",
      dependencies: ["u_wind", "v_wind"],
      description: "Wind speed and meteorological direction derived from U/V components",
    });
  });
});

describe("expandRequestedVariables", () => {
  it("returns a raw variable unchanged", () => {
    expect(expandRequestedVariables(["temperature"]).map((variable) => variable.id)).toEqual(["temperature"]);
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
    expect(expandRequestedVariables(["wind", "relative_humidity"]).every((variable) => variable.kind === "raw")).toBe(true);
  });
});
