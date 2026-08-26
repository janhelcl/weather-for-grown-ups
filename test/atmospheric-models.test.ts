import { describe, expect, it } from "vitest";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  ATMOSPHERIC_MODEL_CATALOG,
  datasetSupportsOperation,
  modelSupportsOperation,
} from "../src/catalog/models.js";

describe("atmospheric dataset capability catalog", () => {
  it("declares forecast and analysis datasets without flattening semantics", () => {
    expect(ATMOSPHERIC_DATASET_CATALOG.gfs_0p25).toMatchObject({
      kind: "deterministic",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 384,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.gefs_0p50).toMatchObject({
      kind: "ensemble",
      role: "forecast",
      horizontalGridDegrees: 0.5,
      maxForecastHour: 384,
      members: 31,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.gfs_grid4_analysis_0p5).toMatchObject({
      kind: "deterministic",
      role: "analysis",
      horizontalGridDegrees: 0.5,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.gfs_grid4_analysis_0p5.maxForecastHour).toBeUndefined();
  });

  it("advertises only operations actually implemented for each dataset", () => {
    expect(datasetSupportsOperation("gfs_0p25", "profile")).toBe(true);
    expect(datasetSupportsOperation("gefs_0p50", "profile")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "profile")).toBe(true);

    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "timeseries")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "layer_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "profile_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "parcel_diagnostics")).toBe(true);

    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "points")).toBe(false);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "transect")).toBe(false);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "area_summary")).toBe(false);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "run_comparison")).toBe(false);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "ensemble_distribution")).toBe(false);
  });

  it("keeps the old model registry vocabulary as a backward-compatible alias", () => {
    expect(ATMOSPHERIC_MODEL_CATALOG).toBe(ATMOSPHERIC_DATASET_CATALOG);
    expect(modelSupportsOperation("gfs_0p25", "points")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "ensemble_distribution")).toBe(true);
  });
});
