import { describe, expect, it } from "vitest";
import {
  expandRequestedFields,
  NON_ISOBARIC_FIELD_CATALOG,
  NON_ISOBARIC_FIELD_IDS,
} from "../src/catalog/non-isobaric-fields.js";
import { ALL_SUPPORTED_GFS_CODES } from "../src/catalog/variables.js";
import { getGfsPressureCatalog } from "../src/catalog/catalog.js";

describe("non-isobaric field catalog", () => {
  it("covers every declared field id exactly once", () => {
    expect(Object.keys(NON_ISOBARIC_FIELD_CATALOG).sort()).toEqual([...NON_ISOBARIC_FIELD_IDS].sort());
  });

  it("models vertical and temporal semantics explicitly", () => {
    expect(NON_ISOBARIC_FIELD_CATALOG.surface_pressure).toMatchObject({
      kind: "raw", gfsCode: "PRES", level: { type: "surface", gribLevel: "surface" }, temporalSemantics: "instantaneous",
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.temperature_2m).toMatchObject({
      kind: "raw", gfsCode: "TMP", level: { type: "height_above_ground_m", heightM: 2 }, temporalSemantics: "instantaneous",
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.total_precipitation).toMatchObject({
      kind: "raw", gfsCode: "APCP", level: { type: "surface" }, temporalSemantics: "accumulation",
      outputs: [{ field: "totalPrecipitationMm", unit: "mm" }],
    });
  });

  it("expands derived winds at multiple heights to exact U/V dependencies", () => {
    expect(expandRequestedFields(["wind_10m"]).map((field) => field.id)).toEqual(["u_wind_10m", "v_wind_10m"]);
    expect(expandRequestedFields(["wind_80m", "u_wind_80m"]).map((field) => field.id)).toEqual(["u_wind_80m", "v_wind_80m"]);
  });

  it("only uses decoder-supported GFS codes", () => {
    const supported = new Set<string>(ALL_SUPPORTED_GFS_CODES);
    expect(Object.values(NON_ISOBARIC_FIELD_CATALOG)
      .filter((field) => field.kind === "raw")
      .every((field) => supported.has(field.gfsCode))).toBe(true);
  });

  it("exposes the new fields through the agent catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.fields.find((field) => field.id === "wind_100m")).toMatchObject({
      kind: "derived", level: { type: "height_above_ground_m", heightM: 100 }, temporalSemantics: "instantaneous",
    });
    expect(catalog.fields.find((field) => field.id === "total_precipitation")).toMatchObject({ temporalSemantics: "accumulation" });
  });
});
