import { describe, expect, it } from "vitest";
import {
  expandRequestedFields,
  GFS_NON_ISOBARIC_FIELD_IDS,
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
    expect(NON_ISOBARIC_FIELD_CATALOG.convective_rain).toMatchObject({
      kind: "raw", gfsCode: "RAIN_CON", level: { type: "surface" }, temporalSemantics: "accumulation",
      outputs: [{ field: "convectiveRainMm", unit: "mm" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.convective_snow).toMatchObject({
      kind: "raw", gfsCode: "SNOW_CON", level: { type: "surface" }, temporalSemantics: "accumulation",
      outputs: [{ field: "convectiveSnowWaterEquivalentMm", unit: "mm" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.visibility).toMatchObject({
      kind: "raw", gfsCode: "VIS", level: { type: "surface" }, temporalSemantics: "instantaneous",
      outputs: [{ field: "visibilityM", unit: "m" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.cloud_ceiling_height_msl).toMatchObject({
      kind: "raw", gfsCode: "CEILING", level: { type: "named_level", id: "cloud_ceiling" },
      temporalSemantics: "instantaneous",
      outputs: [{ field: "cloudCeilingHeightMslM", unit: "m" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_base_height_msl).toMatchObject({
      kind: "raw", gfsCode: "HBAS_SC", level: { type: "named_level", id: "mean_sea_level" },
      temporalSemantics: "instantaneous",
      outputs: [{ field: "shallowConvectiveCloudBaseHeightMslM", unit: "m" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.shallow_convective_cloud_top_height_msl).toMatchObject({
      kind: "raw", gfsCode: "HTOP_SC", level: { type: "named_level", id: "mean_sea_level" },
      temporalSemantics: "instantaneous",
      outputs: [{ field: "shallowConvectiveCloudTopHeightMslM", unit: "m" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.dry_convection_top_height_msl).toMatchObject({
      kind: "raw", gfsCode: "HTOP_DC", level: { type: "named_level", id: "mean_sea_level" },
      temporalSemantics: "instantaneous",
      outputs: [{ field: "dryConvectionTopHeightMslM", unit: "m" }],
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.updraft_helicity_max_2_8km).toMatchObject({
      kind: "raw",
      gfsCode: "UH_MAX",
      level: { type: "named_layer", id: "height_layer_2_8km_msl" },
      temporalSemantics: "maximum",
      outputs: [{ field: "updraftHelicityM2S2", unit: "m^2/s^2" }],
    });
  });

  it("expands derived winds at multiple heights to exact U/V dependencies", () => {
    expect(expandRequestedFields(["wind_10m"]).map((field) => field.id)).toEqual(["u_wind_10m", "v_wind_10m"]);
    expect(expandRequestedFields(["wind_80m", "u_wind_80m"]).map((field) => field.id)).toEqual(["u_wind_80m", "v_wind_80m"]);
  });

  it("keeps GFS fields on GFS-supported codes while regional codes stay separate", () => {
    const supported = new Set<string>(ALL_SUPPORTED_GFS_CODES);
    expect(GFS_NON_ISOBARIC_FIELD_IDS
      .map((id) => NON_ISOBARIC_FIELD_CATALOG[id])
      .filter((field) => field.kind === "raw")
      .every((field) => supported.has(field.gfsCode))).toBe(true);
    for (const id of [
      "convective_rain",
      "convective_snow",
      "visibility",
      "cloud_ceiling_height_msl",
      "shallow_convective_cloud_base_height_msl",
      "shallow_convective_cloud_top_height_msl",
      "dry_convection_top_height_msl",
      "column_maximum_reflectivity",
      "updraft_helicity_max_2_8km",
    ] as const) {
      expect(supported.has(NON_ISOBARIC_FIELD_CATALOG[id].gfsCode)).toBe(false);
    }
  });

  it("exposes the new fields through the agent catalog", () => {
    const catalog = getGfsPressureCatalog();
    expect(catalog.fields.find((field) => field.id === "wind_100m")).toMatchObject({
      kind: "derived", level: { type: "height_above_ground_m", heightM: 100 }, temporalSemantics: "instantaneous",
    });
    expect(catalog.fields.find((field) => field.id === "total_precipitation")).toMatchObject({ temporalSemantics: "accumulation" });
    expect(catalog.fields.some((field) => field.id === "convective_rain")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "convective_snow")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "visibility")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "cloud_ceiling_height_msl")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "shallow_convective_cloud_base_height_msl")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "shallow_convective_cloud_top_height_msl")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "dry_convection_top_height_msl")).toBe(false);
    expect(catalog.fields.some((field) => field.id === "updraft_helicity_max_2_8km")).toBe(false);
  });
});
