import { describe, expect, it } from "vitest";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";

describe("getGfsPressureCatalog", () => {
  it("returns an agent-discoverable pressure catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.model).toBe("gfs_0p25");
    expect(catalog.levelType).toBe("isobaric_hpa");
    expect(catalog.pressureLevelsHpa).toContain(850);
    expect(catalog.pressureLevelsHpa).toContain(0.01);
    expect(catalog.availabilityNote).toMatch(/Not every variable is present at every pressure level/);
  });

  it("exposes all raw and derived variable metadata without internal functions", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.variables).toHaveLength(21);
    expect(catalog.variables.find((variable) => variable.id === "specific_humidity")).toMatchObject({
      kind: "raw",
      gfsCode: "SPFH",
      sourceUnit: "kg/kg",
      outputs: [{ field: "specificHumidityKgKg", unit: "kg/kg" }],
    });
    expect(catalog.variables.find((variable) => variable.id === "wind")).toMatchObject({
      kind: "derived",
      dependencies: ["u_wind", "v_wind"],
    });
    expect(catalog.variables.find((variable) => variable.id === "dew_point")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "relative_humidity"],
      outputs: [{ field: "dewPointC", unit: "degC" }],
    });
    expect(catalog.variables.find((variable) => variable.id === "air_density")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "specific_humidity"],
      outputs: [{ field: "airDensityKgM3", unit: "kg/m^3" }],
    });
    expect(catalog.variables.find((variable) => variable.id === "wet_bulb_temperature")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "specific_humidity"],
      outputs: [{ field: "wetBulbTemperatureC", unit: "degC" }],
    });
    expect(catalog.variables.find((variable) => variable.id === "equivalent_potential_temperature")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "specific_humidity"],
      outputs: [{ field: "equivalentPotentialTemperatureK", unit: "K" }],
    });
  });

  it("returns fresh arrays so callers cannot mutate the canonical catalog", () => {
    const first = getGfsPressureCatalog();
    first.pressureLevelsHpa.pop();
    first.variables.pop();
    const second = getGfsPressureCatalog();
    expect(second.pressureLevelsHpa).toHaveLength(41);
    expect(second.variables).toHaveLength(21);
  });
});
