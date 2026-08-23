import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";
import {
  collectPoint,
  parseFields,
  parseLayerDiagnostics,
  parseLevels,
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
  "ensemble",
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
});
