import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";

const EXPECTED_COMMANDS = [
  "catalog",
  "query",
  "diagnose",
  "compare-runs",
  "compare-datasets",
  "verify",
  "analogs",
  "index",
];

describe("CLI public surface", () => {
  it("registers only the canonical operation vocabulary", () => {
    const names = createCliProgram().commands.map((command) => command.name());

    expect(names).toEqual(EXPECTED_COMMANDS);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no model-, ensemble-, or history-named compatibility commands", () => {
    const names = createCliProgram().commands.map((command) => command.name());

    expect(names.some((name) => name.startsWith("history"))).toBe(false);
    expect(names.some((name) => name.startsWith("ensemble"))).toBe(false);
    expect(names).not.toContain("profile");
    expect(names).not.toContain("points");
    expect(names).not.toContain("timeseries");
    expect(names).not.toContain("transect");
    expect(names).not.toContain("area");
    expect(names).not.toContain("compare-gfs-gefs");
    expect(names).not.toContain("latest");
  });

  it("uses dataset rather than model vocabulary", () => {
    const program = createCliProgram();

    for (const name of ["catalog", "query", "diagnose", "compare-runs"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--dataset")).toBe(true);
      expect(command?.options.some((option) => option.long === "--model")).toBe(false);
    }
  });

  it("exposes GFS grid selection on the canonical forecast-capable commands", () => {
    const program = createCliProgram();

    for (const name of ["query", "diagnose", "compare-runs", "compare-datasets", "verify"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--grid")).toBe(true);
    }
  });

  it("keeps radiosonde verification inside the canonical verify command", () => {
    const verify = createCliProgram().commands.find((command) => command.name() === "verify");
    const options = new Set(verify?.options.map((option) => option.long));

    expect(options).toContain("--reference");
    expect(options).toContain("--station");
    expect(options).toContain("--max-station-distance-km");
    expect(options).toContain("--grid");
    expect(options).toContain("--from");
    expect(options).toContain("--to");
    expect(options).toContain("--hours");
    expect(options).toContain("--max-valid-times");
  });

  it("keeps index maintenance behind one neutral admin command", () => {
    const index = createCliProgram().commands.find((command) => command.name() === "index");
    expect(index?.commands.map((command) => command.name())).toEqual([
      "build",
      "backfill",
      "verification-backfill",
      "verification-summary",
    ]);
  });
});
