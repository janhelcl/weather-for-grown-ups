import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import { runCli } from "../src/cli/run.js";
import { createCliProgram } from "../src/cli/program.js";
import { numberOption, parseCoordinate, parseNumberList } from "../src/cli/shared.js";
import { toPublicFailure, type PublicFailure } from "../src/failure.js";
import { describedSchema } from "../src/mcp-tool-schema.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import { searchAtmosphereCatalogSchema } from "../src/schema/unified-catalog.js";
import {
  ATMOSPHERIC_DATASET_COMPARISON_PAIRS,
  compareAtmosphericDatasetsInputSchema,
  compareAtmosphericDatasetsSchema,
  verifyAtmosphericForecastSchema,
} from "../src/schema/unified-specialized.js";

async function cliFailure(args: string[]): Promise<PublicFailure> {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const previousExitCode = process.exitCode;
  try {
    await runCli(["node", "wfg", ...args, "--json"]);
    const output = stderr.mock.calls.map((call) => String(call[0])).join("\n");
    expect(process.exitCode).toBe(1);
    return (JSON.parse(output) as { error: PublicFailure }).error;
  } finally {
    stderr.mockRestore();
    process.exitCode = previousExitCode;
  }
}

function zodFailure(schema: z.ZodType, input: unknown): PublicFailure {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return toPublicFailure(result.error);
}

const point = { type: "point", latitude: 50, longitude: 10 };
const at = "2026-09-06T00:00:00Z";

describe("Commander usage errors use the public failure envelope", () => {
  it("maps unknown options, unknown commands and missing required options to INVALID_REQUEST", async () => {
    const unknownOption = await cliFailure(["query", "--bogus"]);
    expect(unknownOption.code).toBe("INVALID_REQUEST");
    expect(unknownOption.retryable).toBe(false);
    expect(unknownOption.message).toContain("unknown option '--bogus'");
    expect(unknownOption.message).toContain("wfg query --help");
    expect(unknownOption.details).toEqual({ commanderCode: "commander.unknownOption" });

    const unknownCommand = await cliFailure(["frobnicate"]);
    expect(unknownCommand.code).toBe("INVALID_REQUEST");
    expect(unknownCommand.message).toContain("unknown command 'frobnicate'");
    expect(unknownCommand.message).toContain("wfg --help");

    const missing = await cliFailure(["diagnose", "--lat", "50"]);
    expect(missing.code).toBe("INVALID_REQUEST");
    expect(missing.message).toContain("--lon");
  });

  it("does not treat --help or --version as failures", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    try {
      await runCli(["node", "wfg", "--version"]);
      await runCli(["node", "wfg", "query", "--help"]);
      expect(process.exitCode).toBe(previousExitCode);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("exposes the MCP transports as launcher subcommands", () => {
    const names = createCliProgram().commands.map((command) => command.name());
    expect(names).toContain("mcp");
    expect(names).toContain("mcp-http");
  });

  it("offers --forecast-kind on diagnose like query (MCP parity)", () => {
    const program = createCliProgram();
    for (const name of ["query", "diagnose"]) {
      const command = program.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.some((option) => option.long === "--forecast-kind")).toBe(true);
    }
  });
});

describe("numeric CLI options fail with the flag name instead of NaN", () => {
  it("rejects non-numeric scalars and list entries", async () => {
    expect(() => numberOption("--lat")("abc")).toThrow("Expected --lat to be a number, received: abc");
    expect(() => numberOption("--lat")("")).toThrow("--lat");
    expect(numberOption("--lat")(" 50.5 ")).toBe(50.5);
    expect(parseNumberList("850, 500", "--levels")).toEqual([850, 500]);
    expect(() => parseNumberList("850,abc", "--levels")).toThrow("Expected --levels to be a number, received: abc");
    expect(() => parseNumberList(",", "--levels")).toThrow("at least one number");
    expect(() => parseCoordinate("50", "--start")).toThrow("Expected --start lat,lon");
    expect(() => parseCoordinate("50,x", "--start")).toThrow("Expected numeric --start lat,lon");

    const failure = await cliFailure(["query", "--lat", "abc", "--lon", "10", "--at", at]);
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.message).toBe("Expected --lat to be a number, received: abc");
    expect(failure.details).toEqual({ option: "--lat", received: "abc" });
  });
});

describe("compare_datasets dispatches to one registered pair contract", () => {
  it("covers every registered pair", () => {
    for (const [left, right] of ATMOSPHERIC_DATASET_COMPARISON_PAIRS) {
      const failure = zodFailure(compareAtmosphericDatasetsSchema, { datasets: [left, right] });
      expect(failure.message).not.toContain("Unsupported comparison pair");
      expect(failure.message).toContain(`${left}↔${right} comparison`);
    }
  });

  it("names the offending field under the selected pair instead of a union-wide 'Invalid input'", () => {
    const failure = zodFailure(compareAtmosphericDatasetsSchema, {
      datasets: ["gfs", "gefs"],
      geometry: point,
      time: { at },
      variable: "temperature",
    });
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.message).toContain("at pressureLevelHpa");
    expect(failure.message).toContain("gfs↔gefs comparison");
    expect(failure.message).not.toBe("Request validation failed: Invalid input");
  });

  it("explains reversed and unregistered pairs and lists the registered vocabulary", () => {
    const reversed = zodFailure(compareAtmosphericDatasetsSchema, {
      datasets: ["gefs", "gfs"], geometry: point, time: { at }, variable: "temperature", pressureLevelHpa: 850,
    });
    expect(reversed.message).toContain("gefs↔gfs is registered as gfs↔gefs");

    const unregistered = zodFailure(compareAtmosphericDatasetsSchema, {
      datasets: ["gfs", "arome"], geometry: point, time: { at }, variable: "temperature", pressureLevelHpa: 850,
    });
    expect(unregistered.message).toContain("Unsupported comparison pair: gfs↔arome");
    expect(unregistered.message).toContain("Registered pairs: gfs↔gefs");

    const malformed = zodFailure(compareAtmosphericDatasetsSchema, { datasets: "gfs" });
    expect(malformed.message).toContain("datasets must be a [left, right] pair");
  });

  it("requires datasets explicitly instead of defaulting to gfs↔gefs", () => {
    const failure = zodFailure(compareAtmosphericDatasetsSchema, {
      geometry: point, time: { at }, variable: "temperature", pressureLevelHpa: 850,
    });
    expect(failure.message).toContain("at datasets: datasets is required");
    expect(failure.message).toContain("Registered pairs: gfs↔gefs");
  });

  it("advertises the same pair contracts for discovery", () => {
    const json = z.toJSONSchema(compareAtmosphericDatasetsInputSchema, { io: "input" }) as { anyOf?: unknown[] };
    expect(json.anyOf).toHaveLength(ATMOSPHERIC_DATASET_COMPARISON_PAIRS.length);
  });
});

describe("verify_forecast dispatches on the time form", () => {
  it("reports atomic-form issues at their field", () => {
    const failure = zodFailure(verifyAtmosphericForecastSchema, {
      geometry: point, time: { at }, leadHours: 7, variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(failure.message).toContain("at leadHours");
    expect(failure.message).toContain("multiple of 6");
    expect(failure.message).toContain("atomic verification");
  });

  it("reports skill-summary issues at their field with an actionable cycle message", () => {
    const failure = zodFailure(verifyAtmosphericForecastSchema, {
      geometry: point,
      time: { from: "2026-08-01T00:00:00Z", to: "2026-08-03T00:00:00Z", hoursUtc: [3] },
      leadHours: [24],
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect(failure.message).toContain("at time.hoursUtc.0");
    expect(failure.message).toContain("0, 6, 12 or 18 UTC");
    expect(failure.message).toContain("skill-summary verification");
  });

  it("rejects mixed or missing time forms explicitly", () => {
    const mixed = zodFailure(verifyAtmosphericForecastSchema, {
      geometry: point, time: { at, from: at }, leadHours: 6, variables: ["temperature"], pressureLevelsHpa: [850],
    });
    expect(mixed.message).toContain("exactly one time form");
  });
});

describe("request objects reject unknown keys and explain union mismatches", () => {
  it("rejects misspelled or unsupported keys instead of silently ignoring them", () => {
    const catalog = zodFailure(searchAtmosphereCatalogSchema, { dataset: "gfs" });
    expect(catalog.code).toBe("INVALID_REQUEST");
    expect(catalog.message).toContain('Unrecognized key: "dataset"');

    const query = zodFailure(queryAtmosphereSchema, {
      dataset: "gfs",
      geometry: point,
      time: { at },
      selection: { variables: ["temperature"], pressureLevelHpa: [850] },
    });
    expect(query.message).toContain("at selection");
    expect(query.message).toContain('"pressureLevelHpa"');
  });

  it("names the failing geometry field via the type discriminator", () => {
    const failure = zodFailure(queryAtmosphereSchema, {
      dataset: "gfs",
      geometry: { type: "point", latitude: "abc", longitude: 10 },
      time: { at },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(failure.message).toBe(
      "Request validation failed at geometry.latitude: Invalid input: expected number, received string",
    );

    const badType = zodFailure(queryAtmosphereSchema, {
      dataset: "gfs",
      geometry: { type: "circle", latitude: 1, longitude: 10 },
      time: { at },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(badType.message).toContain("geometry.type must be point, points, transect or area");
  });

  it("follows the closest time form when one branch is clearly nearer", () => {
    const failure = zodFailure(queryAtmosphereSchema, {
      dataset: "gfs",
      geometry: point,
      time: { from: at },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(failure.message).toBe(
      "Request validation failed at time.to: Invalid input: expected string, received undefined",
    );
  });

  it("summarises tied union branches instead of reporting 'Invalid input'", () => {
    const schema = z.object({
      time: z.union([
        z.object({ at: z.string() }),
        z.object({ from: z.string(), to: z.string() }),
      ], { error: "time must be { at } or { from, to }" }),
    });
    const failure = zodFailure(schema, { time: { from: at } });
    expect(failure.message).toContain("at time: time must be { at } or { from, to }");
    expect(failure.message).toContain("Closest forms: [at: ");
    expect(failure.message).toContain(" or [to: ");
  });

  it("counts additional issues in the lead message", () => {
    const failure = zodFailure(queryAtmosphereSchema, {
      dataset: "gfs",
      geometry: { type: "point", latitude: 500, longitude: 10 },
      time: { at: "yesterday" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    expect(failure.message).toMatch(/\(\+\d+ more in details\.issues\)$/);
    expect((failure.details as { issues: unknown[] }).issues.length).toBeGreaterThan(1);
  });
});

describe("MCP tool schemas describe without validating", () => {
  it("keeps the JSON Schema for discovery while accepting any value for validation", async () => {
    const described = describedSchema(queryAtmosphereSchema);
    const standard = described["~standard"];
    const json = standard.jsonSchema.input({ target: "draft-2020-12" }) as {
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    expect(Object.keys(json.properties ?? {})).toEqual(
      expect.arrayContaining(["dataset", "geometry", "time", "selection"]),
    );
    expect(json.additionalProperties).toBe(false);

    const result = await standard.validate({ anything: true });
    expect("issues" in result && result.issues).toBeFalsy();
  });
});
