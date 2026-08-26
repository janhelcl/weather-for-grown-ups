import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";
import {
  collectPoint,
  gefsBundleSelection,
  parseAtmosphericModel,
  parseFields,
  parseGefsFields,
  parseGefsMembers,
  parseGefsProfileVariables,
  parseGefsVariables,
  parseLayerDiagnostics,
  parseLevels,
  parseNumbers,
  parseProfileDiagnostics,
  parseVariables,
  pointSelection,
} from "../src/cli/shared.js";

const EXPECTED_COMMANDS = [
  "catalog",
  "latest",
  "profile",
  "points",
  "timeseries",
  "points-timeseries",
  "compare-runs",
  "history",
  "history-timeseries",
  "ensemble",
  "ensemble-profile",
  "ensemble-timeseries",
  "ensemble-fields",
  "ensemble-fields-timeseries",
  "ensemble-fields-points",
  "ensemble-fields-points-timeseries",
  "ensemble-parcel",
  "ensemble-parcel-timeseries",
  "compare-gfs-gefs",
  "layer",
  "profile-diagnostics",
  "parcel",
  "diagnostic-timeseries",
  "transect",
  "area",
];

describe("CLI program registration", () => {
  it("registers the complete public command surface exactly once", () => {
    const names = createCliProgram().commands.map((command) => command.name());

    expect(names).toEqual(EXPECTED_COMMANDS);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps one root program rather than routed command programs", () => {
    const program = createCliProgram();

    expect(program.name()).toBe("wfg");
    expect(program.version()).toBe("0.1.0");
    expect(program.commands).toHaveLength(EXPECTED_COMMANDS.length);
  });

  it("keeps canonical shared operations model-selectable without multiplying commands", () => {
    const program = createCliProgram();
    for (const name of ["profile", "points", "timeseries", "points-timeseries", "layer", "profile-diagnostics", "diagnostic-timeseries", "compare-runs", "transect"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--model")).toBe(true);
    }
  });
});

describe("CLI shared parsing", () => {
  it("uses the default pressure selection when no fields are specified", () => {
    expect(pointSelection(undefined, undefined, undefined)).toEqual({
      variables: ["temperature", "relative_humidity", "wind"],
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
    });
  });

  it("supports fields-only selections without silently adding pressure defaults", () => {
    expect(pointSelection(undefined, undefined, "temperature_2m,wind_10m")).toEqual({
      fields: ["temperature_2m", "wind_10m"],
    });
    expect(gefsBundleSelection(undefined, undefined, "temperature_2m,wind_10m", "temperature", "850")).toEqual({
      variables: [],
      pressureLevelsHpa: [],
      fields: ["temperature_2m", "wind_10m"],
    });
  });

  it("fills the missing half of an explicit pressure selection with defaults", () => {
    expect(pointSelection("dew_point", undefined, undefined)).toEqual({
      variables: ["dew_point"],
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
    });
    expect(pointSelection(undefined, "850,700", undefined)).toEqual({
      variables: ["temperature", "relative_humidity", "wind"],
      pressureLevelsHpa: [850, 700],
    });
    expect(gefsBundleSelection("dew_point", undefined, undefined, "temperature", "850")).toEqual({
      variables: ["dew_point"],
      pressureLevelsHpa: [850],
      fields: [],
    });
    expect(gefsBundleSelection(undefined, "850,700", undefined, "temperature", "850")).toEqual({
      variables: ["temperature"],
      pressureLevelsHpa: [850, 700],
      fields: [],
    });
  });

  it("parses repeatable point coordinates and rejects malformed coordinates", () => {
    expect(collectPoint("50.08,14.43", undefined)).toEqual([{ latitude: 50.08, longitude: 14.43 }]);
    expect(collectPoint("46.24,13.18", [{ latitude: 50.08, longitude: 14.43 }])).toEqual([
      { latitude: 50.08, longitude: 14.43 },
      { latitude: 46.24, longitude: 13.18 },
    ]);
    expect(() => collectPoint("50.08", undefined)).toThrow("Expected --point lat,lon");
    expect(() => collectPoint("north,east", undefined)).toThrow("Expected numeric --point lat,lon");
  });

  it("parses comma-separated CLI lists consistently", () => {
    expect(parseVariables("temperature, wind")).toEqual(["temperature", "wind"]);
    expect(parseGefsVariables("temperature, u_wind")).toEqual(["temperature", "u_wind"]);
    expect(parseGefsProfileVariables("temperature, dew_point")).toEqual(["temperature", "dew_point"]);
    expect(parseGefsFields("temperature_2m, wind_10m")).toEqual(["temperature_2m", "wind_10m"]);
    expect(parseGefsMembers("p02, c00,p01")).toEqual(["p02", "c00", "p01"]);
    expect(parseNumbers("0.1, 0.5,0.9")).toEqual([0.1, 0.5, 0.9]);
    expect(parseLevels("1000, 850,700")).toEqual([1000, 850, 700]);
    expect(parseFields(undefined)).toEqual([]);
    expect(parseFields("temperature_2m, low_cloud_cover")).toEqual(["temperature_2m", "low_cloud_cover"]);
    expect(parseLayerDiagnostics("temperature_lapse_rate, wind_shear")).toEqual([
      "temperature_lapse_rate",
      "wind_shear",
    ]);
    expect(parseProfileDiagnostics("freezing_level_crossings, temperature_inversion_layers")).toEqual([
      "freezing_level_crossings",
      "temperature_inversion_layers",
    ]);
  });

  it("normalizes supported atmospheric CLI model aliases and rejects unknown models", () => {
    expect(parseAtmosphericModel("GFS")).toBe("gfs");
    expect(parseAtmosphericModel(" gefs ")).toBe("gefs");
    expect(() => parseAtmosphericModel("ecmwf")).toThrow("Expected --model gfs|gefs");
  });
});
