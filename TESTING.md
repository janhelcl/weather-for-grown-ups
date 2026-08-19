# Testing

The default test suite is intentionally deterministic and offline. No test is allowed to contact NOAA/NOMADS or NOAA AWS unless it explicitly replaces the global `fetch` stub. This prevents CI from depending on upstream availability and ensures the test suite itself can never violate NOMADS request-spacing rules.

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

- Query schema boundaries, timezone handling, and `run: latest` defaulting.
- GFS run validation, forecast-hour cadence, and 384-hour horizon.
- Latest-complete-run cycle flooring, backward search, UTC date rollover, TTL caching, and failure behavior.
- NOAA AWS complete-run marker URL construction and HEAD-response handling.
- Variable catalog expansion and dependency deduplication.
- NOMADS Grib Filter URL construction, canonical ordering, and geographic clipping.
- Wind vector derivation and normalization invariants.
- `wgrib2` output parsing, command invocation, and failure behavior.
- Cross-caller file locking, stale-lock recovery, failure cleanup, and the 11-second default courtesy interval.
- GRIB cache hits, concurrent request deduplication, HTTP failures, invalid upstream content, and atomic writes.
- End-to-end profile orchestration with fake cache/decoder/latest-run dependencies, including units, provenance, explicit-vs-latest run selection, level filtering, and derived wind.
- MCP profile and latest-run success/error response mapping.
- Compiled CLI smoke tests on Node 20 and Node 24.

## Coverage gates

The V8 coverage job includes production code under `src/` except the process-boundary entrypoints `src/cli.ts` and `src/mcp.ts`. Those entrypoints are covered by compilation and smoke checks; their underlying logic is tested through the core service and MCP handlers.

CI fails below these global thresholds:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

## Live NOAA smoke test

The real upstream smoke test is deliberately opt-in:

```bash
npm run test:live
```

It requires network access and a working `wgrib2` binary. It first resolves the latest **complete** GFS cycle by checking the public NOAA AWS `f384.idx` marker, then makes one small pressure-profile request through the production NOMADS cache/rate limiter and decodes it with real `wgrib2`.

Do not add this command to normal PR CI. If we later schedule it, it should remain low-frequency and use the same production courtesy limiter/cache.
