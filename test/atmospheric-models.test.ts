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
    expect(ATMOSPHERIC_DATASET_CATALOG.aigfs_0p25).toMatchObject({
      family: "aigfs",
      provider: "noaa",
      modelClass: "ai",
      kind: "deterministic",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 384,
      nativeForecastIntervalHours: 6,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.aigefs_0p25).toMatchObject({
      family: "aigefs",
      provider: "noaa",
      modelClass: "ai",
      kind: "ensemble",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 384,
      nativeForecastIntervalHours: 6,
      members: 31,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.gefs_0p50).toMatchObject({
      kind: "ensemble",
      role: "forecast",
      horizontalGridDegrees: 0.5,
      maxForecastHour: 384,
      members: 31,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.ifs_0p25).toMatchObject({
      family: "ifs",
      kind: "deterministic",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 240,
    });
    expect(ATMOSPHERIC_DATASET_CATALOG.ifs_ens_0p25).toMatchObject({
      family: "ifs",
      kind: "ensemble",
      role: "forecast",
      horizontalGridDegrees: 0.25,
      maxForecastHour: 360,
      members: 50,
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
    expect(datasetSupportsOperation("aigfs_0p25", "profile")).toBe(true);
    expect(datasetSupportsOperation("aigfs_0p25", "layer_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("aigfs_0p25", "profile_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("aigfs_0p25", "parcel_diagnostics")).toBe(false);
    expect(datasetSupportsOperation("aigfs_0p25", "run_comparison")).toBe(false);
    expect(datasetSupportsOperation("aigefs_0p25", "profile")).toBe(true);
    expect(datasetSupportsOperation("aigefs_0p25", "ensemble_distribution")).toBe(true);
    expect(datasetSupportsOperation("aigefs_0p25", "parcel_diagnostics")).toBe(false);
    expect(datasetSupportsOperation("aigefs_0p25", "run_comparison")).toBe(false);
    expect(datasetSupportsOperation("gefs_0p50", "profile")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "profile")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "timeseries")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "points")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "points_timeseries")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "transect")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "layer_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "profile_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "parcel_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "diagnostic_timeseries")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "area_summary")).toBe(true);
    expect(datasetSupportsOperation("ifs_0p25", "run_comparison")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "profile")).toBe(true);

    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "timeseries")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "layer_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "profile_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "parcel_diagnostics")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "diagnostic_timeseries")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "points")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "points_timeseries")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "transect")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "area_summary")).toBe(true);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "run_comparison")).toBe(false);
    expect(datasetSupportsOperation("gfs_grid4_analysis_0p5", "ensemble_distribution")).toBe(false);
  });

  it("keeps the model registry vocabulary limited to operational forecast models", () => {
    expect(Object.keys(ATMOSPHERIC_MODEL_CATALOG)).toEqual([
      "gfs_0p25",
      "gfs_0p50",
      "aigfs_0p25",
      "aigefs_0p25",
      "gefs_0p50",
      "ifs_0p25",
      "ifs_ens_0p25",
    ]);
    expect(modelSupportsOperation("gfs_0p25", "points")).toBe(true);
    expect(modelSupportsOperation("gfs_0p50", "run_comparison")).toBe(true);
    expect(modelSupportsOperation("gfs_0p50", "aligned_model_comparison")).toBe(true);
    expect(modelSupportsOperation("aigfs_0p25", "profile")).toBe(true);
    expect(modelSupportsOperation("aigfs_0p25", "parcel_diagnostics")).toBe(false);
    expect(modelSupportsOperation("aigefs_0p25", "ensemble_distribution")).toBe(true);
    expect(modelSupportsOperation("aigefs_0p25", "parcel_diagnostics")).toBe(false);
    expect(modelSupportsOperation("gefs_0p50", "ensemble_distribution")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "profile")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "timeseries")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "layer_diagnostics")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "profile_diagnostics")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "parcel_diagnostics")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "diagnostic_timeseries")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "area_summary")).toBe(true);
    expect(modelSupportsOperation("ifs_0p25", "run_comparison")).toBe(true);
    expect(modelSupportsOperation("ifs_ens_0p25", "ensemble_distribution")).toBe(true);
    expect(modelSupportsOperation("ifs_ens_0p25", "aligned_model_comparison")).toBe(true);
  });
});
