import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { searchAtmosphereCatalog } from "../dist/catalog/unified-search.js";

// Offline, compiled-package benchmark. Timings are observations, not CI gates.
const cases = {
  help: ["dist/cli.js", "--help"],
  catalog: ["dist/cli.js", "catalog", "--search", "wind", "--limit", "3", "--json"],
  capabilities: ["dist/cli.js", "capabilities", "--dataset", "gfs", "--json"],
  mcpRegistration: ["--input-type=module", "-e", 'const { createMcpServer } = await import("./dist/mcp-server.js"); await createMcpServer().close();'],
};
const results = {};
for (const [name, args] of Object.entries(cases)) {
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const started = performance.now();
    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  results[name] = { medianMs: Math.round(samples[3]), minMs: Math.round(samples[0]) };
}
const queries = [{}, { search: "wind" }, { search: "temperature", datasets: ["gfs"] },
  { search: "cloud", datasets: ["gefs"], forecastKind: "reforecast" }];
for (const query of queries) searchAtmosphereCatalog(query);
const started = performance.now();
for (let i = 0; i < 1_000; i++) searchAtmosphereCatalog(queries[i % queries.length]);
results.catalog1000 = { totalMs: Math.round(performance.now() - started) };
console.log(JSON.stringify({ node: process.version, ...results }, null, 2));
