import { describe, expect, it } from "vitest";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  ATMOSPHERIC_DATASET_IDS,
} from "../src/catalog/models.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  PUBLIC_DATASET_METADATA,
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
