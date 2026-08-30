import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";
import { registerUnifiedAtmosphereTools } from "../src/mcp-unified-tool.js";

const SURFACE_OPERATIONS = [
  ["catalog", "search_catalog"],
  ["query", "query_atmosphere"],
  ["diagnose", "diagnose_atmosphere"],
  ["compare-runs", "compare_runs"],
  ["compare-datasets", "compare_datasets"],
  ["verify", "verify_forecast"],
  ["analogs", "find_analogs"],
] as const;

describe("unified CLI/MCP surface equivalence", () => {
  it("exposes the same atmospheric operations on both public surfaces", () => {
    const cli = createCliProgram();
    const cliCommands = new Set(cli.commands.map((command) => command.name()));

    const mcpTools: string[] = [];
    registerUnifiedAtmosphereTools({
      registerTool(name: string) {
        mcpTools.push(name);
      },
    } as any);
    const mcpToolNames = new Set(mcpTools);

    for (const [cliName, mcpName] of SURFACE_OPERATIONS) {
      expect(cliCommands.has(cliName), `CLI operation ${cliName}`).toBe(true);
      expect(mcpToolNames.has(mcpName), `MCP operation ${mcpName}`).toBe(true);
    }

    expect(mcpTools.sort()).toEqual(SURFACE_OPERATIONS.map(([, mcpName]) => mcpName).sort());
  });
});
