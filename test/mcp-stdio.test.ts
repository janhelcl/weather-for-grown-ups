import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WFG_VERSION } from "../src/version.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const stdioEntry = resolve(repoRoot, "src/mcp.ts");
const scratchCacheDir = mkdtempSync(join(tmpdir(), "wfg-stdio-smoke-"));

const openClients: Client[] = [];

afterEach(async () => {
  const clients = openClients.splice(0);
  await Promise.all(clients.map((client) => client.close()));
});

afterAll(() => {
  rmSync(scratchCacheDir, { recursive: true, force: true });
});

async function connectStdio(): Promise<Client> {
  const client = new Client(
    { name: "wfg-stdio-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  openClients.push(client);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, stdioEntry],
    cwd: repoRoot,
    stderr: "pipe",
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      // Keep the smoke test hermetic: nothing here should touch the real cache or network.
      WFG_CACHE_DIR: scratchCacheDir,
    },
  }));
  return client;
}

describe("stdio MCP", () => {
  it("has the stdio runtime available for the smoke test", () => {
    expect(existsSync(tsxCli)).toBe(true);
    expect(existsSync(stdioEntry)).toBe(true);
  });

  it("initializes over stdio with the same server identity and tool catalog as HTTP", async () => {
    const client = await connectStdio();

    const serverVersion = client.getServerVersion();
    expect(serverVersion?.name).toBe("weather-for-grown-ups");
    expect(serverVersion?.version).toBe(WFG_VERSION);
    expect(client.getInstructions()).toContain("search_catalog");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_catalog",
      "query_atmosphere",
      "diagnose_atmosphere",
      "compare_runs",
      "compare_datasets",
      "verify_forecast",
      "find_analogs",
    ]);
  }, 30_000);

  it("serves a local search_catalog call and a typed failure envelope over stdio", async () => {
    const client = await connectStdio();

    const success = await client.callTool({
      name: "search_catalog",
      arguments: { search: "temperature", sections: ["variables"], limit: 3 },
    });
    expect(success.isError).not.toBe(true);
    const payload = success.structuredContent as { matches: Array<{ id: string }> };
    expect(payload.matches.length).toBeGreaterThan(0);
    expect(payload.matches.some((match) => match.id === "temperature")).toBe(true);

    // Out-of-domain rejection happens before any source access, so this stays offline.
    const failure = await client.callTool({
      name: "query_atmosphere",
      arguments: {
        dataset: "icon-d2",
        geometry: { type: "point", latitude: 40.7, longitude: -74 },
        time: { at: "2026-09-06T12:00:00Z" },
        selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      },
    });
    expect(failure.isError).toBe(true);
    const text = (failure.content as Array<{ type: string; text?: string }>)[0]?.text;
    expect(typeof text).toBe("string");
    const envelope = JSON.parse(text!) as { error: { code: string; message: string; retryable: boolean } };
    expect(envelope.error.code).toBe("OUT_OF_DOMAIN");
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.message.length).toBeGreaterThan(0);
  }, 30_000);
});
