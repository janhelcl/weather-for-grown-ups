#!/usr/bin/env node

const mode = process.argv[2];

if (mode === "mcp") {
  process.argv.splice(2, 1);
  await import("./mcp.js");
} else if (mode === "mcp-http") {
  process.argv.splice(2, 1);
  await import("./mcp-http.js");
} else {
  const { runCli } = await import("./cli/run.js");
  await runCli(process.argv);
}
