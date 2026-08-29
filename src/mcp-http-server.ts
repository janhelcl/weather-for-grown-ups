import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServer } from "./mcp-server.js";
import { WFG_VERSION } from "./version.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface McpHttpConfig {
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export interface McpHttpServer {
  server: Server;
  closeHandler: () => Promise<void>;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, values) => item.length > 0 && values.indexOf(item) === index);
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function hostnameFromAuthority(authority: string | undefined): string | null {
  if (!authority) return null;
  try {
    return normalizeHostname(new URL(`http://${authority}`).hostname);
  } catch {
    return null;
  }
}

function hostnameFromOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return null;
  }
}

function reject(res: ServerResponse, message: string): false {
  res.statusCode = 403;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
  return false;
}

function validateAllowlistedHost(req: IncomingMessage, res: ServerResponse, allowedHosts: string[]): boolean {
  const hostname = hostnameFromAuthority(req.headers.host);
  if (!hostname || !allowedHosts.includes(hostname)) {
    return reject(res, "Forbidden Host");
  }
  return true;
}

function validateAllowlistedOrigin(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  const rawOrigin = req.headers.origin;
  if (!rawOrigin) return true;
  const hostname = hostnameFromOrigin(rawOrigin);
  if (!hostname || !allowedOrigins.includes(hostname)) {
    return reject(res, "Forbidden Origin");
  }
  return true;
}

function validateNoUnexpectedRemoteOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.headers.origin) return true;
  return reject(res, "Forbidden Origin; configure WFG_MCP_ALLOWED_ORIGINS for browser clients");
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

export function loadMcpHttpConfig(env: NodeJS.ProcessEnv = process.env): McpHttpConfig {
  const host = env.WFG_MCP_HOST?.trim() || "127.0.0.1";
  const portText = env.WFG_MCP_PORT?.trim() || "3000";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WFG_MCP_PORT must be an integer from 1 to 65535; received ${JSON.stringify(portText)}`);
  }

  const allowedHosts = parseCsv(env.WFG_MCP_ALLOWED_HOSTS).map(normalizeHostname);
  const allowedOrigins = parseCsv(env.WFG_MCP_ALLOWED_ORIGINS).map(normalizeHostname);
  if (!LOOPBACK_HOSTS.has(normalizeHostname(host)) && allowedHosts.length === 0) {
    throw new Error(
      `WFG_MCP_ALLOWED_HOSTS is required when WFG_MCP_HOST=${JSON.stringify(host)} is not loopback`,
    );
  }

  return { host, port, allowedHosts, allowedOrigins };
}

export function createMcpHttpServer(config: McpHttpConfig): McpHttpServer {
  const handler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler(handler);
  const isLoopback = LOOPBACK_HOSTS.has(normalizeHostname(config.host));
  const validateLocalHost = localhostHostValidation();
  const validateLocalOrigin = localhostOriginValidation();

  const server = createNodeServer((req, res) => {
    if (config.allowedHosts.length > 0) {
      if (!validateAllowlistedHost(req, res, config.allowedHosts)) return;
    } else if (isLoopback) {
      if (!validateLocalHost(req, res)) return;
    }

    if (config.allowedOrigins.length > 0) {
      if (!validateAllowlistedOrigin(req, res, config.allowedOrigins)) return;
    } else if (isLoopback) {
      if (!validateLocalOrigin(req, res)) return;
    } else if (!validateNoUnexpectedRemoteOrigin(req, res)) {
      return;
    }

    const path = requestPath(req);
    if (path === "/healthz") {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("allow", "GET");
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", service: "weather-for-grown-ups", version: WFG_VERSION }));
      return;
    }

    if (path !== "/mcp") {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return;
    }

    if (!req.method) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Missing HTTP method");
      return;
    }

    void nodeHandler(req as Parameters<typeof nodeHandler>[0], res);
  });

  return {
    server,
    closeHandler: () => handler.close(),
  };
}
