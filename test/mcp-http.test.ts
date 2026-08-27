import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpHttpServer,
  loadMcpHttpConfig,
  type McpHttpServer,
} from "../src/mcp-http-server.js";

const realFetch = globalThis.fetch;
const openServers: McpHttpServer[] = [];

async function listenOnLoopback(instance: McpHttpServer): Promise<URL> {
  openServers.push(instance);
  await new Promise<void>((resolve, reject) => {
    instance.server.once("error", reject);
    instance.server.listen(0, "127.0.0.1", () => {
      instance.server.off("error", reject);
      resolve();
    });
  });
  const address = instance.server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
}

async function closeInstance(instance: McpHttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!instance.server.listening) {
      resolve();
      return;
    }
    instance.server.close((error) => (error ? reject(error) : resolve()));
  });
  await instance.closeHandler();
}

afterEach(async () => {
  const instances = openServers.splice(0);
  await Promise.all(instances.map(closeInstance));
});

describe("Streamable HTTP MCP", () => {
  it("defaults to a loopback-only server", () => {
    expect(loadMcpHttpConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      allowedHosts: [],
      allowedOrigins: [],
    });
  });

  it("requires an explicit host allowlist for non-loopback binds", () => {
    expect(() => loadMcpHttpConfig({ WFG_MCP_HOST: "0.0.0.0" })).toThrow(/WFG_MCP_ALLOWED_HOSTS/);
    expect(loadMcpHttpConfig({
      WFG_MCP_HOST: "0.0.0.0",
      WFG_MCP_ALLOWED_HOSTS: "weather.example.com, api.weather.example.com",
    }).allowedHosts).toEqual(["weather.example.com", "api.weather.example.com"]);
  });

  it("serves the same registered tool catalog over Streamable HTTP", async () => {
    const instance = createMcpHttpServer(loadMcpHttpConfig({}));
    const url = await listenOnLoopback(instance);
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(input instanceof Request ? input.url : input);
      if (requestUrl.hostname !== "127.0.0.1") {
        throw new Error(`Unexpected non-loopback network access in HTTP MCP test: ${requestUrl}`);
      }
      return realFetch(input, init);
    });

    const client = new Client(
      { name: "wfg-http-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );

    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual([
        "search_catalog",
        "query_atmosphere",
        "diagnose_atmosphere",
        "compare_runs",
        "compare_datasets",
        "verify_forecast",
        "find_analogs",
      ]);
      expect(names.some((name) => name.startsWith("get_gfs_"))).toBe(false);
      expect(names.some((name) => name.startsWith("get_gefs_"))).toBe(false);
      expect(names.some((name) => name.includes("historical"))).toBe(false);
    } finally {
      await client.close();
    }
  });
});
