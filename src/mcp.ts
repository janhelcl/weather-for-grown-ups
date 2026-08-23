import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp-server.js";

void serveStdio(createMcpServer);
