import { describe, expect, it } from "vitest";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";
import { searchGfsCatalog } from "../src/catalog/search.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

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

  it("does not advertise or accept regional-only reflectivity as GFS", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.fields.some(
      (field) => field.id === "column_maximum_reflectivity",
    )).toBe(false);
    expect(searchGfsCatalog({
      search: "column maximum reflectivity",
      sections: ["fields"],
    }).matches).toEqual([]);

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-31T06:00:00Z" },
      selection: { fields: ["column_maximum_reflectivity"] },
      forecast: { run: "2026-08-31T00:00:00Z" },
    })).toThrow("GFS fields not supported");
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
