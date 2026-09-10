import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";
import { WFG_VERSION } from "../src/version.js";

const EXPECTED_COMMANDS = [
  "catalog",
  "capabilities",
  "availability",
  "query",
  "diagnose",
  "align",
  "verify",
  "analogs",
  "index",
  // Transport launchers: same services exposed to MCP clients, not new operations.
  "mcp",
  "mcp-http",
];

describe("CLI public surface", () => {
  it("reports the package version", () => {
    expect(createCliProgram().version()).toBe(WFG_VERSION);
  });

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

    for (const name of ["catalog", "capabilities", "availability", "query", "diagnose"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--dataset")).toBe(true);
      expect(command?.options.some((option) => option.long === "--model")).toBe(false);
    }
    // align takes N dataset-shaped sources; the dataset vocabulary lives inside --source.
    const align = program.commands.find((candidate) => candidate.name() === "align");
    expect(align?.options.some((option) => option.long === "--source")).toBe(true);
    expect(align?.options.some((option) => option.long === "--model")).toBe(false);
    expect(align?.options.some((option) => option.long === "--dataset")).toBe(false);
  });

  it("advertises the complete unified dataset and source vocabulary", () => {
    const program = createCliProgram();
    const catalog = program.commands.find((command) => command.name() === "catalog");
    const capabilities = program.commands.find((command) => command.name() === "capabilities");
    const availability = program.commands.find((command) => command.name() === "availability");
    const query = program.commands.find((command) => command.name() === "query");

    expect(catalog?.options.find((option) => option.long === "--dataset")?.flags)
      .toContain("gfs|aigfs|aigefs|hgefs|icon-d2|icon-d2-eps|arome|pe-arome|gefs|ifs|aifs|aifs-ens|ifs-ens|gfs-analysis|all");
    expect(capabilities?.options.find((option) => option.long === "--dataset")?.flags)
      .toContain("gfs|aigfs|aigefs|hgefs|icon-d2|icon-d2-eps|arome|pe-arome|gefs|ifs|aifs|aifs-ens|ifs-ens|gfs-analysis");
    expect(availability?.options.find((option) => option.long === "--dataset")?.flags)
      .toContain("gfs|aigfs|aigefs|hgefs|icon-d2|icon-d2-eps|arome|pe-arome|gefs|ifs|aifs|aifs-ens|ifs-ens|gfs-analysis");
    expect(query?.options.find((option) => option.long === "--source")?.flags)
      .toContain("nomads|s3|archive");
  });

  it("exposes GFS grid selection on the canonical forecast-capable commands", () => {
    const program = createCliProgram();

    for (const name of ["availability", "query", "diagnose", "verify"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--grid")).toBe(true);
    }
    // Capability inspection can test a planned GFS grid without fetching data.
    const capabilities = program.commands.find((candidate) => candidate.name() === "capabilities");
    expect(capabilities?.options.some((option) => option.long === "--grid")).toBe(true);
    // align carries grid selection per source (`gfs;grid=0p50`) rather than as a global flag.
    const align = program.commands.find((candidate) => candidate.name() === "align");
    expect(align?.options.find((option) => option.long === "--source")?.description).toContain("grid=");
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