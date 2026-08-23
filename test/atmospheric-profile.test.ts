import { describe, expect, it } from "vitest";
import { fromGefsMemberProfiles, memberValuesToLevels } from "../src/core/atmospheric-profile.js";
import { gefsEnsembleProfileResultSchema } from "../src/schema/gefs-ensemble-profile.js";

describe("model-independent pressure profile adaptation", () => {
  it("maps GEFS member values into the same normalized pressure-level shape used by GFS diagnostics", () => {
    expect(memberValuesToLevels([850, 500], [
      { variable: "temperature", pressureLevelHpa: 850, value: 3 },
      { variable: "u_wind", pressureLevelHpa: 850, value: 5 },
      { variable: "v_wind", pressureLevelHpa: 850, value: -1 },
      { variable: "geopotential_height", pressureLevelHpa: 850, value: 1500 },
      { variable: "temperature", pressureLevelHpa: 500, value: -18 },
      { variable: "u_wind", pressureLevelHpa: 500, value: 15 },
      { variable: "v_wind", pressureLevelHpa: 500, value: 4 },
      { variable: "geopotential_height", pressureLevelHpa: 500, value: 5600 },
    ])).toEqual([
      { pressureHpa: 850, temperatureC: 3, uWindMs: 5, vWindMs: -1, geopotentialHeightGpm: 1500 },
      { pressureHpa: 500, temperatureC: -18, uWindMs: 15, vWindMs: 4, geopotentialHeightGpm: 5600 },
    ]);
  });

  it("requires memberwise profile data before adapting an ensemble", () => {
    const result = gefsEnsembleProfileResultSchema.parse({
      model: "gefs_0p50",
      run: "2026-08-23T12:00:00Z",
      validTime: "2026-08-23T18:00:00Z",
      forecastHour: 6,
      requestedPoint: { latitude: 50.08, longitude: 14.43 },
      gridPoint: { latitude: 50, longitude: 14.5 },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
      summaries: [{
        variable: "temperature",
        gfsCode: "TMP",
        pressureLevelHpa: 850,
        outputField: "temperatureC",
        unit: "degC",
        memberCount: 2,
        mean: 1,
        populationStdDev: 1,
        min: 0,
        max: 2,
        quantiles: [{ quantile: 0.5, value: 1 }],
      }],
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: true,
      },
    });
    expect(() => fromGefsMemberProfiles(result)).toThrow("includeMembers=true");
  });
});
