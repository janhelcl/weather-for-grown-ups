import { describe, expect, it } from "vitest";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  ATMOSPHERIC_DATASET_IDS,
} from "../src/catalog/models.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  PUBLIC_DATASET_METADATA,
  publicDatasetCapabilities,
} from "../src/schema/unified-api.js";

describe("unified dataset capability registry", () => {
  it("backs every public dataset with one registered internal dataset", () => {
    for (const dataset of PUBLIC_ATMOSPHERIC_DATASET_IDS) {
      const metadata = PUBLIC_DATASET_METADATA[dataset];
      expect(ATMOSPHERIC_DATASET_IDS).toContain(metadata.internalDatasetId);
      expect(ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId]).toMatchObject({
        role: metadata.role,
        kind: metadata.kind,
      });
    }
  });

  it("declares domain, native grid, and cadence for every current dataset", () => {
    for (const dataset of ATMOSPHERIC_DATASET_IDS) {
      const definition = ATMOSPHERIC_DATASET_CATALOG[dataset];
      if (dataset === "icon_d2_0p02" || dataset === "icon_d2_eps_2p1km") {
        expect(definition.spatialDomain).toMatchObject({
          scope: "limited_area",
          bounds: {
            westLongitude: -0.25,
            eastLongitude: 17.54,
            southLatitude: 43.42,
            northLatitude: 57.31,
          },
        });
      } else if (dataset === "arome_0p01") {
        expect(definition.spatialDomain).toMatchObject({
          scope: "limited_area",
          bounds: {
            westLongitude: -12,
            eastLongitude: 16,
            southLatitude: 37.5,
            northLatitude: 55.4,
          },
        });
      } else {
        expect(definition.spatialDomain).toEqual({ scope: "global" });
      }
      expect(definition.nativeTimeCadenceHours.length).toBeGreaterThan(0);
      expect(definition.nativeGrid.type).toMatch(
        /regular_latlon|rotated_latlon|icosahedral|lambert_conformal|mixed/,
      );
    }

    expect(ATMOSPHERIC_DATASET_CATALOG.hgefs_0p25.nativeGrid).toEqual({
      type: "mixed",
      components: [
        {
          dataset: "gefs_0p50",
          type: "regular_latlon",
          nominalResolution: { value: 0.5, unit: "degrees" },
        },
        {
          dataset: "aigefs_0p25",
          type: "regular_latlon",
          nominalResolution: { value: 0.25, unit: "degrees" },
        },
      ],
    });

    expect(publicDatasetCapabilities("icon-d2")).toMatchObject({
      provider: "dwd",
      spatialDomain: { scope: "limited_area" },
      horizontalGridDegrees: 0.02,
      nativeGrid: {
        type: "icosahedral",
        nominalResolution: { value: 2.1, unit: "km" },
      },
      maxForecastHour: 48,
      nativeTimeCadenceHours: [1],
      nativeForecastIntervalHours: 1,
    });

    expect(publicDatasetCapabilities("icon-d2-eps")).toMatchObject({
      provider: "dwd",
      kind: "ensemble",
      spatialDomain: { scope: "limited_area" },
      nativeGrid: {
        type: "icosahedral",
        nominalResolution: { value: 2.1, unit: "km" },
      },
      maxForecastHour: 48,
      nativeTimeCadenceHours: [1],
      nativeForecastIntervalHours: 1,
      members: 20,
    });

    expect(publicDatasetCapabilities("arome")).toMatchObject({
      provider: "meteo_france",
      kind: "deterministic",
      spatialDomain: { scope: "limited_area" },
      horizontalGridDegrees: 0.01,
      nativeGrid: {
        type: "lambert_conformal",
        nominalResolution: { value: 1.3, unit: "km" },
      },
      maxForecastHour: 51,
      nativeTimeCadenceHours: [1],
      nativeForecastIntervalHours: 1,
    });

    expect(publicDatasetCapabilities("ifs")).toMatchObject({
      spatialDomain: { scope: "global" },
      nativeGrid: {
        type: "regular_latlon",
        nominalResolution: { value: 0.25, unit: "degrees" },
      },
      maxForecastHour: 240,
      nativeTimeCadenceHours: [3, 6],
    });
  });

  it("keeps deterministic IFS and IFS ENS horizons and semantics distinct", () => {
    expect(ATMOSPHERIC_DATASET_CATALOG.ifs_0p25).toMatchObject({
      kind: "deterministic",
      role: "forecast",
      maxForecastHour: 240,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.ifs_ens_0p25).toMatchObject({
      kind: "ensemble",
      role: "forecast",
      maxForecastHour: 360,
      members: 50,
    });
  });

  it("declares the implemented IFS ENS unified capabilities", () => {
    const operations = ATMOSPHERIC_DATASET_CATALOG.ifs_ens_0p25.operations;
    expect(operations).toEqual(expect.arrayContaining([
      "profile",
      "timeseries",
      "layer_diagnostics",
      "profile_diagnostics",
      "diagnostic_timeseries",
      "parcel_diagnostics",
      "points",
      "points_timeseries",
      "transect",
      "area_summary",
      "run_comparison",
      "ensemble_distribution",
      "aligned_model_comparison",
    ]));
  });
});
