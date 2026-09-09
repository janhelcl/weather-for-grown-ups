---
name: weather-for-grown-ups
description: Query operational and historical numerical weather prediction with Weather for Grown Ups (WFG), including deterministic forecasts, ensembles, AI and hybrid weather models, regional NWP, profiles, transects, diagnostics, model and run comparisons, verification, and analogs. Use when a task needs structured NWP evidence rather than a consumer-weather summary.
license: MIT
compatibility: Requires network access. Prefer the WFG CLI when a shell and Node.js 20+ are available; use WFG MCP tools when the host already exposes them.
metadata:
  author: janhelcl
  repository: https://github.com/janhelcl/weather-for-grown-ups
---

# Weather for Grown Ups

Use WFG as a weather evidence engine. It returns numerical-model data, diagnostics, comparisons, verification, and provenance. Interpretation belongs to the calling agent or application.

## Choose the interface

1. When a shell and Node.js 20+ are available, prefer the CLI, including for agents that could also use MCP:
   ```bash
   npx -y weather-for-grown-ups ...
   ```
2. When a suitable shell is not available, use WFG MCP tools if the host exposes them.
3. For repeated local CLI use, an installed `wfg` or `weather-for-grown-ups` binary is equivalent to the `npx` form.
4. Do not start `mcp` just to answer through a shell. `mcp` and `mcp-http` are transport launchers for MCP hosts.

CLI and MCP use the same schemas and application services.

## Discover before guessing

When dataset, field, geometry, cadence, horizon, member, or diagnostic support is uncertain, query the catalog.

CLI:

```bash
npx -y weather-for-grown-ups catalog --dataset all --search wind --json
```

MCP: use `search_catalog`.

Treat catalog output as the source of truth. Do not infer that two models expose the same field or operation just because they are comparable in principle.

## Core query

Normal atmospheric access follows:

```text
dataset × geometry × time × selection
```

For example:

```bash
npx -y weather-for-grown-ups query \
  --dataset gfs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,wind \
  --levels 850,700,500 \
  --json
```

For MCP use `query_atmosphere` with the equivalent structured request.

Always use `--json` for CLI calls whose output will be reasoned over or passed to another tool.

## Operation map

| Intent | CLI | MCP |
| --- | --- | --- |
| Discover fields and capabilities | `catalog` | `search_catalog` |
| Query atmospheric state | `query` | `query_atmosphere` |
| Derive layer/profile/parcel meteorology | `diagnose` | `diagnose_atmosphere` |
| Compare forecast cycles | `compare-runs` | `compare_runs` |
| Compare registered model pairs | `compare-datasets` | `compare_datasets` |
| Verify archived forecasts | `verify` | `verify_forecast` |
| Search historical analogs | `analogs` | `find_analogs` |

History index build/backfill is administrative and CLI-only.

If syntax is unclear, use:

```bash
npx -y weather-for-grown-ups <command> --help
```

## Working rules

- Keep the selected dataset explicit.
- Preserve initialization time, valid time, forecast lead, member population, native grid, domain, cadence, and provenance when they matter to the conclusion.
- Unsupported combinations are information. Do not silently substitute another field, grid, dataset, or member population.
- Ensemble diagnostics are member-first. Do not derive a nonlinear diagnostic from an ensemble-mean atmosphere unless that is explicitly the requested quantity.
- Ensemble spread and member fractions are raw model evidence, not automatically calibrated uncertainty or probability.
- Keep archived forecasts distinct from later analyses and observations.
- For regional models, respect the published domain and native-resolution semantics.
- For cross-model comparisons, use only registered WFG comparison paths rather than inventing pointwise symmetry between incompatible products.
- On `INVALID_REQUEST`, use the structured error details to repair the request. On `DATA_UNAVAILABLE`, `OUT_OF_DOMAIN`, `UPSTREAM_UNAVAILABLE`, or `RATE_LIMITED`, preserve the failure meaning rather than hiding it behind a different query.

## Presenting results

Separate:

1. deterministic guidance, if used;
2. ensemble distribution or spread, if used;
3. disagreement across runs or models;
4. verification or historical evidence, if used;
5. provenance, capability limits, and unresolved uncertainty.

WFG does not own activity-specific scores or safety decisions. Do not convert model evidence into a go/no-go decision unless the calling task supplies and justifies that decision layer.
