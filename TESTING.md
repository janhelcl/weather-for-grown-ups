# Testing

The default test suite is intentionally deterministic and offline. No test is allowed to contact NOAA/NOMADS unless it explicitly replaces the global `fetch` stub. This prevents CI from depending on upstream availability and ensures the test suite itself can never violate NOMADS request-spacing rules.

## Commands

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:smoke
```

`npm run test:smoke` runs the compiled CLI help paths and therefore requires `npm run build` first.

## Layers covered

- Query schema boundaries and timezone handling.
- GFS run validation, forecast-hour cadence, and 384-hour horizon.
- Variable catalog expansion and dependency deduplication.
- NOMADS Grib Filter URL construction, canonical ordering, and geographic clipping.
- Wind vector derivation and normalization invariants.
- `wgrib2` output parsing, command invocation, and failure behavior.
- Cross-caller file locking, stale-lock recovery, failure cleanup, and the 11-second default courtesy interval.
- GRIB cache hits, concurrent request deduplication, HTTP failures, invalid upstream content, and atomic writes.
- End-to-end profile orchestration with fake cache/decoder dependencies, including units, provenance, level filtering, and derived wind.
- MCP tool success/error response mapping.
- Compiled CLI smoke tests on Node 20 and Node 24.

## Coverage gates

The V8 coverage job includes production code under `src/` except the process-boundary entrypoints `src/cli.ts` and `src/mcp.ts`. Those entrypoints are covered by compilation and smoke checks; their underlying logic is tested through the core service and MCP handler.

CI fails below these global thresholds:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

## Live NOAA checks

Live NOAA requests do **not** belong in the normal PR test suite. If a live contract/smoke test is added later, keep it opt-in or scheduled, perform the smallest possible request, and route it through the same rate limiter/cache as production code.
