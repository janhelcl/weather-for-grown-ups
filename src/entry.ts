#!/usr/bin/env node
import { runCli } from "./cli/run.js";

// `weather-for-grown-ups` and `wfg` share one program; `mcp` and `mcp-http`
// are ordinary subcommands that launch the MCP transports.
await runCli(process.argv, "weather-for-grown-ups");
