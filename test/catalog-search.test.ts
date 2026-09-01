import { describe, expect, it } from "vitest";
import { searchGfsCatalog } from "../src/catalog/search.js";
import { catalogSearchQuerySchema, catalogSearchResultSchema } from "../src/schema/catalog-search.js";

describe("catalog search schema", () => {
  it("defaults to a compact 30-result limit", () => {
    expect(catalogSearchQuerySchema.parse({})).toEqual({ limit: 30 });
  });

  it("validates filters and bounded limits", () => {
    expect(catalogSearchQuerySchema.safeParse({ sections: ["fields"], classification: "raw", temporalSemantics: "average", limit: 100 }).success).toBe(true);
    expect(catalogSearchQuerySchema.safeParse({ sections: [] }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ classification: "magic" }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ temporalSemantics: "maximum" }).success).toBe(true);
    expect(catalogSearchQuerySchema.safeParse({ temporalSemantics: "minimum" }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ search: "   " }).success).toBe(false);
  });
});

describe("searchGfsCatalog", () => {
  it("finds a pressure-level derived variable from natural text", () => {
    const result = searchGfsCatalog({ search: "wet bulb" });
    expect(result.matches[0]).toMatchObject({
      section: "variables",
      id: "wet_bulb_temperature",
      classification: "derived",
      kind: "derived",
      verticalSemantics: "isobaric_hpa",
    });
    expect(result.matches[0]?.dependencies).toEqual(["temperature", "specific_humidity"]);
    expect(result.matches[0]?.outputs).toEqual([
      expect.objectContaining({ field: "wetBulbTemperatureC", unit: "degC" }),
    ]);
  });

  it("ranks an exact ID above broader text matches", () => {
    const result = searchGfsCatalog({ search: "wind_shear" });
    expect(result.matches[0]).toMatchObject({ section: "layer_diagnostics", id: "wind_shear" });
    expect(result.matches[0]?.score).toBeGreaterThan(900);
  });

  it("filters fields by exact temporal semantics and multiple search tokens", () => {
    const result = searchGfsCatalog({
      search: "low cloud cover",
      sections: ["fields"],
      temporalSemantics: "average",
    });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.matches[0]).toMatchObject({
      section: "fields",
      id: "low_cloud_cover_average",
      temporalSemantics: "average",
      verticalSemantics: "low cloud layer",
    });
    expect(result.matches.every((match) => match.section === "fields" && match.temporalSemantics === "average")).toBe(true);
  });

  it("treats diagnostics and parcel definitions as derived for classification filtering", () => {
    const derived = searchGfsCatalog({
      search: "parcel",
      classification: "derived",
      sections: ["parcel_definitions"],
    });
    expect(derived.matches).not.toHaveLength(0);
    expect(derived.matches.every((match) => match.classification === "derived")).toBe(true);

    const raw = searchGfsCatalog({
      search: "parcel",
      classification: "raw",
      sections: ["parcel_definitions"],
    });
    expect(raw.totalMatches).toBe(0);
  });

  it("searches dependencies, output names, units, codes, and vertical semantics", () => {
    expect(searchGfsCatalog({ search: "SPFH", sections: ["variables"] }).matches[0]?.id).toBe("specific_humidity");
    expect(searchGfsCatalog({ search: "temperatureLapseRateCPerKm" }).matches[0]?.id).toBe("temperature_lapse_rate");
    expect(searchGfsCatalog({ search: "low cloud layer LCDC", sections: ["fields"] }).matches.some((match) => match.id === "low_cloud_cover")).toBe(true);
  });

  it("normalizes underscores, hyphens, case, and whitespace", () => {
    const a = searchGfsCatalog({ search: "  EQUIVALENT-potential_temperature " });
    expect(a.matches[0]?.id).toBe("equivalent_potential_temperature");
  });

  it("returns a deterministic compact browse result when no text search is supplied", () => {
    const result = searchGfsCatalog({ sections: ["variables"], limit: 5 });
    expect(result.totalMatches).toBe(21);
    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.matches.map((match) => match.id)).toEqual([
      "absolute_vorticity",
      "air_density",
      "cloud_water_mixing_ratio",
      "dew_point",
      "divergence",
    ]);
  });

  it("reports zero matches without broadening the query", () => {
    const result = searchGfsCatalog({ search: "definitely_not_a_meteorological_field" });
    expect(result.totalMatches).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("returns output that satisfies the public result contract", () => {
    const result = searchGfsCatalog({ search: "cloud", limit: 10 });
    expect(catalogSearchResultSchema.parse(result)).toEqual(result);
  });
});
