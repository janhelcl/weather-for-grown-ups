import { describe, expect, it, vi } from "vitest";
import { createCliProgram } from "../src/cli/program.js";
import { registerUnifiedAtmosphereTools } from "../src/mcp-unified-tool.js";

vi.mock("../src/core/unified-atmosphere-api.js", () => { throw new Error("weather services loaded during discovery"); });
vi.mock("../src/core/atmospheric-availability.js", () => { throw new Error("availability services loaded during discovery"); });
vi.mock("../src/core/history-backfill.js", () => { throw new Error("history services loaded during discovery"); });
vi.mock("../src/core/history-index.js", () => { throw new Error("index services loaded during discovery"); });
vi.mock("../src/core/verification-index-backfill.js", () => { throw new Error("verification services loaded during discovery"); });
vi.mock("../src/core/verification-index-skill.js", () => { throw new Error("skill services loaded during discovery"); });

describe("agent discovery startup", () => {
  it("registers CLI commands and executes local discovery without loading weather services", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createCliProgram();
    expect(program.helpInformation()).toContain("query");
    await program.parseAsync(["catalog", "--search", "wind", "--limit", "1", "--json"], { from: "user" });
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(output.matches).toHaveLength(1);
    await createCliProgram().parseAsync(["capabilities", "--dataset", "gfs", "--json"], { from: "user" });
  });

  it("accepts CLI pagination and explains empty human-readable searches", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
    await createCliProgram().parseAsync(["catalog", "--search", "wind", "--limit", "2", "--offset", "2", "--json"], { from: "user" });
    const page = JSON.parse(log.mock.calls[0]![0] as string);
    expect(page.query.offset).toBe(2);
    expect(page.nextOffset).toBe(4);
    await createCliProgram().parseAsync(["catalog", "--search", "no_such_quantity_123"], { from: "user" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Try fewer search words"));
    await createCliProgram().parseAsync(["catalog", "--search", "wind", "--limit", "2"], { from: "user" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--offset 2"));
  });

  it("registers MCP tools and executes local discovery without loading weather services", async () => {
    const handlers = new Map<string, (query: unknown) => Promise<any>>();
    const definitions = new Map<string, any>();
    registerUnifiedAtmosphereTools({
      registerTool(name: string, definition: unknown, handler: (query: unknown) => Promise<any>) {
        definitions.set(name, definition);
        handlers.set(name, handler);
      },
    } as any);
    for (const [name, definition] of definitions) {
      expect(definition.annotations.readOnlyHint).toBe(name !== "find_analogs");
      expect(definition.annotations.destructiveHint).toBe(false);
    }
    expect(definitions.get("search_catalog").annotations.openWorldHint).toBe(false);
    expect(definitions.get("query_atmosphere").annotations.openWorldHint).toBe(true);
    expect(definitions.get("find_analogs").annotations.openWorldHint).toBe(true);
    const catalog = await handlers.get("search_catalog")!({ search: "wind", limit: 1 });
    expect(catalog.isError).toBeUndefined();
    expect(catalog.structuredContent.matches).toHaveLength(1);
    const capabilities = await handlers.get("inspect_capabilities")!({ dataset: "gfs" });
    expect(capabilities.isError).toBeUndefined();
    const invalid = await handlers.get("search_catalog")!({ sections: ["invalid"] });
    expect(invalid.isError).toBe(true);
    expect(JSON.parse(invalid.content[0].text).error.code).toBe("INVALID_REQUEST");
  });
});
