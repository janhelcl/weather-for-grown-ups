# WFG interfaces

WFG has one application core and two normal agent-facing transports. The meteorological meaning of an operation must not depend on which transport invokes it.

## Selection rule

Prefer CLI when a shell is available and the `wfg` executable or `npx weather-for-grown-ups` can run. Use MCP when shell execution is unavailable/restricted, the deployment is remote, or the host exposes WFG only as MCP tools.

Do not alternate between transports merely because one invocation produced a meteorological capability error. Transport fallback is appropriate for transport/setup failure; it is not a way to bypass unsupported atmospheric semantics.

## Capability mapping

| Intent | CLI | MCP |
| --- | --- | --- |
| discover fields and capabilities | `wfg catalog ... --json` | `search_catalog` |
| query atmospheric state | `wfg query ... --json` | `query_atmosphere` |
| derive layer/profile/parcel meteorology | `wfg diagnose ... --json` | `diagnose_atmosphere` |
| align datasets, runs or member populations | `wfg align --source … --source … --json` | `align_atmosphere` |
| verify archived forecasts | `wfg verify ... --json` | `verify_forecast` |
| search historical analogs | `wfg analogs ... --json` | `find_analogs` |

Administrative history-index build/backfill is intentionally CLI-only and is not part of the normal weather-query surface.

## CLI workflow

Use CLI help as the syntax source of truth:

```bash
wfg --help
wfg query --help
wfg align --help
```

If WFG is not globally installed, use the npm package directly:

```bash
npx weather-for-grown-ups --help
npx weather-for-grown-ups catalog --dataset all --search wind --json
```

For repeated agent use, a global install makes the short `wfg` executable convenient:

```bash
npm install -g weather-for-grown-ups
wfg --help
```

Prefer JSON for machine inspection and composition:

```bash
wfg catalog --dataset all --search wind --json
wfg query ... --json
```

It is valid for a shell-capable agent to save focused intermediate evidence, process JSON with standard shell tooling, or execute independent queries concurrently. Do not build a wrapper API around WFG; invoke WFG itself.

## MCP workflow

The stdio server is available from the same npm package:

```bash
npx weather-for-grown-ups mcp
```

Generic process-spawned MCP configuration:

```json
{
  "command": "npx",
  "args": ["-y", "weather-for-grown-ups", "mcp"]
}
```

A Streamable HTTP server is also available with `npx weather-for-grown-ups mcp-http`; deployment and Host/Origin policy are documented in `docs/INSTALL.md` in the WFG repository.

When using MCP, inspect the host-provided tool schemas for exact current arguments rather than copying invocation details from this skill.

## Failure classification

Treat failures in two categories.

### Transport/setup failure

Examples: executable absent, npm unavailable, MCP server unreachable, host not configured.

A transport fallback is reasonable if another WFG transport is already available. Otherwise explain the setup problem.

### Atmospheric capability failure

Examples: field absent in a dataset, pressure level unsupported, regional point outside domain, an alignment source reported `status: "failed"`, historical coverage unavailable.

Do not switch transport. Re-plan the meteorological investigation within declared capabilities or report the limitation.
