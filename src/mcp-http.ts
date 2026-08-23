#!/usr/bin/env node
import { createMcpHttpServer, loadMcpHttpConfig } from "./mcp-http-server.js";

const config = loadMcpHttpConfig();
const { server, closeHandler } = createMcpHttpServer(config);
let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  server.close();
  await closeHandler();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

server.listen(config.port, config.host, () => {
  console.error(`Weather for Grown Ups MCP listening on http://${config.host}:${config.port}/mcp`);
});
