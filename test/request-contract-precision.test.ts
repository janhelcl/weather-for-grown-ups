import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import { runCli } from "../src/cli/run.js";
import { createCliProgram } from "../src/cli/program.js";
import { numberOption, parseCoordinate, parseNumberList } from "../src/cli/shared.js";
import { toPublicFailure, type PublicFailure } from "../src/failure.js";
import { describedSchema } from "../src/mcp-tool-schema.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";
import { searchAtmosphereCatalogSchema } from "../src/schema/unified-catalog.js";
import { alignAtmosphereSchema, MAX_ALIGNMENT_SOURCES } from "../src/schema/unified-alignment.js";
import { verifyAtmosphericForecastSchema } from "../src/schema/unified-specialized.js";

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

describe("align_atmosphere validates each source with query_atmosphere semantics", () => {
  const selection = { variables: ["temperature"], pressureLevelsHpa: [850] };

  it("names the offending source index and field", () => {
    const unknownDataset = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "ecmwf" }], geometry: point, time: { at }, selection,
    });
    expect(unknownDataset.code).toBe("INVALID_REQUEST");
    expect(unknownDataset.message).toContain("at sources.1.dataset");

    const ensembleOnDeterministic = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs", ensemble: { quantiles: [0.5] } }, { dataset: "ifs" }],
      geometry: point, time: { at }, selection,
    });
    expect(ensembleOnDeterministic.message).toContain("at sources.0.ensemble");

    const unsupportedRun = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "gefs", forecast: { run: "latest_complete" } }],
      geometry: point, time: { at }, selection,
    });
    expect(unsupportedRun.message).toContain("at sources.1.forecast.run");
  });

  it("leaves dataset capability gaps on the shared selection or geometry to inline per-source failures", () => {
    // AROME is field-only and ICON-D2 is regional: the request is still well-formed, the
    // answer for those sources is "cannot serve this selection/point", reported inline.
    expect(alignAtmosphereSchema.safeParse({
      sources: [{ dataset: "gfs" }, { dataset: "arome" }, { dataset: "icon-d2" }],
      geometry: { type: "point", latitude: -33.9, longitude: 151.2 },
      time: { at }, selection,
    }).success).toBe(true);
  });

  it("keeps the shared selection canonical and rejects unknown vocabulary at its path", () => {
    const failure = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "ifs" }],
      geometry: point, time: { at },
      selection: { variables: ["temp"], pressureLevelsHpa: [850] },
    });
    expect(failure.message).toContain("at selection.variables.0");
    expect(failure.message).toContain("search_catalog");
  });

  it("bounds the fan-out and rejects redundant or ambiguous sources", () => {
    const one = zodFailure(alignAtmosphereSchema, { sources: [{ dataset: "gfs" }], geometry: point, time: { at }, selection });
    expect(one.message).toContain("at sources");
    expect(one.message).toMatch(/at least 2|>=2/);

    const tooMany = zodFailure(alignAtmosphereSchema, {
      sources: Array.from({ length: MAX_ALIGNMENT_SOURCES + 1 }, (_, index) => ({ dataset: "gfs", forecast: { run: `2026-09-0${(index % 9) + 1}T00:00:00Z` }, label: `s${index}` })),
      geometry: point, time: { at }, selection,
    });
    expect(tooMany.message).toContain(`${MAX_ALIGNMENT_SOURCES}`);

    const duplicate = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "gfs" }], geometry: point, time: { at }, selection,
    });
    expect(duplicate.message).toContain("at sources.1");
    expect(duplicate.message).toContain("selects the same dataset, forecast, ensemble and source as sources[0]");

    const clashingLabels = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs", label: "a" }, { dataset: "ifs", label: "a" }], geometry: point, time: { at }, selection,
    });
    expect(clashingLabels.message).toContain("at sources.1.label");
  });

  it("does not expose member-level fan-out through alignment", () => {
    const failure = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "gefs", ensemble: { includeMembers: true } }],
      geometry: point, time: { at }, selection,
    });
    expect(failure.message).toContain("at sources.1.ensemble");
  });

  it("is a point primitive: spatial geometries are rejected at geometry", () => {
    const failure = zodFailure(alignAtmosphereSchema, {
      sources: [{ dataset: "gfs" }, { dataset: "ifs" }],
      geometry: { type: "bbox", north: 51, south: 50, west: 14, east: 15 },
      time: { at }, selection,
    });
    expect(failure.message).toContain("at geometry");
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
