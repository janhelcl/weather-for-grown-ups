import { describe, expect, it } from "vitest";
import { getGefsCatalog } from "../src/catalog/gefs-catalog.js";
import { rawGefsFieldDefinitions } from "../src/catalog/gefs-fields.js";
import { searchGefsCatalog } from "../src/catalog/gefs-search.js";

describe("GEFS catalog", () => {
  it("exposes verified pgrb2a pressure, derived-profile and non-isobaric semantics", () => {
    const catalog = getGefsCatalog();
    expect(catalog.model).toBe("gefs_0p50");
    expect(catalog.product).toBe("pgrb2a_0p50");
    expect(catalog.fieldProducts).toEqual([
      { product: "pgrb2s_0p25", horizontalGridDegrees: 0.25, maxForecastHour: 240 },
      { product: "pgrb2a_0p50", horizontalGridDegrees: 0.5, maxForecastHour: 384 },
    ]);
    expect(catalog.variables.find((value) => value.id === "temperature")?.supportedPressureLevelsHpa).toContain(850);
    expect(catalog.variables.find((value) => value.id === "u_wind")?.supportedPressureLevelsHpa).toContain(300);
    expect(catalog.variables.find((value) => value.id === "dew_point")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "relative_humidity"],
    });
    expect(catalog.variables.find((value) => value.id === "potential_temperature")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature"],
    });
    expect(catalog.fields.find((value) => value.id === "total_precipitation")).toMatchObject({
      temporalSemantics: "accumulation",
      gfsCode: "APCP",
    });
    expect(catalog.fields.find((value) => value.id === "total_atmosphere_cloud_cover")).toMatchObject({
      temporalSemantics: "average",
      gfsCode: "TCDC",
    });
    expect(catalog.fields.find((value) => value.id === "cape_180mb")?.level.gribLevel).toBe("180-0 mb above ground");
    expect(catalog.fields.find((value) => value.id === "temperature_2m")).toMatchObject({
      horizontalGridDegrees: [0.25, 0.5],
      highResolutionThroughForecastHour: 240,
    });
    expect(catalog.fieldSemanticsNote).toContain("pgrb2s 0.25°");
  });

  it("exposes implemented GEFS parcel definitions with model-specific dependencies", () => {
    const catalog = getGefsCatalog();
    expect(catalog.parcelDefinitions).toHaveLength(3);
    expect(catalog.parcelDefinitions.find((definition) => definition.id === "surface_2m")).toMatchObject({
      pressureDependencies: ["temperature", "relative_humidity", "geopotential_height"],
      fieldDependencies: ["surface_pressure", "temperature_2m", "relative_humidity_2m"],
      staticDependencies: ["same_cycle_f000_surface_geopotential_height"],
    });
    expect(catalog.parcelDiagnosticsNote).toContain("raw member fractions");
  });

  it("expands derived wind into one deduplicated raw field selection", () => {
    expect(rawGefsFieldDefinitions(["wind_10m", "u_wind_10m"]).map((value) => value.id)).toEqual([
      "u_wind_10m",
      "v_wind_10m",
    ]);
  });

  it("searches GEFS-specific field semantics", () => {
    const result = searchGefsCatalog({ search: "cloud average" });
    expect(result.model).toBe("gefs_0p50");
    expect(result.matches[0]).toMatchObject({
      section: "fields",
      id: "total_atmosphere_cloud_cover",
      temporalSemantics: "average",
    });
  });

  it("searches derived profile and parcel capabilities", () => {
    const dewPoint = searchGefsCatalog({ search: "dew point" });
    expect(dewPoint.matches[0]).toMatchObject({
      section: "variables",
      id: "dew_point",
      classification: "derived",
    });
    const parcel = searchGefsCatalog({ search: "most unstable parcel", sections: ["parcel_definitions"] });
    expect(parcel.matches[0]).toMatchObject({
      section: "parcel_definitions",
      id: "most_unstable_300hpa",
      classification: "derived",
    });
  });

  it("supports filtering and limiting search", () => {
    const result = searchGefsCatalog({ sections: ["fields"], classification: "raw", limit: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.matches.every((match) => match.section === "fields" && match.classification === "raw")).toBe(true);
  });
});
