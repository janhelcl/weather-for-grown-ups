import { describe, expect, it } from "vitest";
import { getGefsCatalog } from "../src/catalog/gefs-catalog.js";
import { rawGefsFieldDefinitions } from "../src/catalog/gefs-fields.js";
import { searchGefsCatalog } from "../src/catalog/gefs-search.js";

describe("GEFS catalog", () => {
  it("exposes verified pgrb2a pressure and non-isobaric semantics", () => {
    const catalog = getGefsCatalog();
    expect(catalog.model).toBe("gefs_0p50");
    expect(catalog.product).toBe("pgrb2a_0p50");
    expect(catalog.variables.find((value) => value.id === "temperature")?.supportedPressureLevelsHpa).toContain(850);
    expect(catalog.variables.find((value) => value.id === "u_wind")?.supportedPressureLevelsHpa).toContain(300);
    expect(catalog.fields.find((value) => value.id === "total_precipitation")).toMatchObject({
      temporalSemantics: "accumulation",
      gfsCode: "APCP",
    });
    expect(catalog.fields.find((value) => value.id === "total_atmosphere_cloud_cover")).toMatchObject({
      temporalSemantics: "average",
      gfsCode: "TCDC",
    });
    expect(catalog.fields.find((value) => value.id === "cape_180mb")?.level.gribLevel).toBe("180-0 mb above ground");
    expect(catalog.parcelDefinitions).toEqual([]);
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

  it("supports filtering and limiting search", () => {
    const result = searchGefsCatalog({ sections: ["fields"], classification: "raw", limit: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.matches.every((match) => match.section === "fields" && match.classification === "raw")).toBe(true);
  });
});
