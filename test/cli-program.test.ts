import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";

const EXPECTED_COMMANDS = [
  "catalog",
  "latest",
  "profile",
  "points",
  "timeseries",
  "points-timeseries",
  "compare-runs",
  "layer",
  "profile-diagnostics",
  "parcel",
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
