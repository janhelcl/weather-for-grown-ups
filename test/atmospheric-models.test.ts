import { describe, expect, it } from "vitest";
import {
  ATMOSPHERIC_MODEL_CATALOG,
  modelSupportsOperation,
} from "../src/catalog/models.js";

describe("atmospheric model capability catalog", () => {
  it("declares shared operations without pretending model semantics are identical", () => {
    expect(ATMOSPHERIC_MODEL_CATALOG.gfs_0p25.kind).toBe("deterministic");
    expect(ATMOSPHERIC_MODEL_CATALOG.gefs_0p50.kind).toBe("ensemble");
    expect(modelSupportsOperation("gfs_0p25", "profile")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "profile")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "points")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "points")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "timeseries")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "timeseries")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "layer_diagnostics")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "layer_diagnostics")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "profile_diagnostics")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "profile_diagnostics")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "diagnostic_timeseries")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "diagnostic_timeseries")).toBe(true);
    expect(modelSupportsOperation("gfs_0p25", "run_comparison")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "run_comparison")).toBe(true);
  });

  it("keeps unsupported capabilities explicit", () => {
    expect(modelSupportsOperation("gfs_0p25", "parcel_diagnostics")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "parcel_diagnostics")).toBe(false);
    expect(modelSupportsOperation("gfs_0p25", "points_timeseries")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "points_timeseries")).toBe(false);
    expect(modelSupportsOperation("gfs_0p25", "area_summary")).toBe(true);
    expect(modelSupportsOperation("gefs_0p50", "area_summary")).toBe(false);
  });
});
