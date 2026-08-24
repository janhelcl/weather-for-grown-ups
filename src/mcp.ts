import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp-extended-server.js";

void serveStdio(createMcpServer);
