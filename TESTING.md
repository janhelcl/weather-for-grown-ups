# Testing

The default test suite is intentionally deterministic and offline. No test is allowed to contact NOAA/NOMADS or NOAA AWS unless it explicitly replaces the global `fetch` stub.

## Commands

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:smoke
```

## Layers covered

- Query schema boundaries, timezone handling, run/source defaults, and time-series step guards.
- GFS run validation, single-time forecast-hour validation, full native cadence, range intersection, and 384-hour horizon.
- Bounded asynchronous mapping, stable output ordering, and failure propagation.
- Latest-complete-run discovery and caching.
- NOAA AWS `.idx` parsing, byte-range selection, subset caching, and failure paths.
- NOMADS URL planning, pacing, cache behavior, and failure paths.
- `wgrib2` parsing/invocation and wind derivation.
- Point profile orchestration across NOMADS/S3.
- Point time-series orchestration, native cadence around f120, latest-run resolution, source consistency, grid consistency, bounded concurrency, cache-hit propagation, and max-step rejection.
- MCP latest/profile/time-series success and error mappings.
- Compiled CLI smoke tests on Node 20 and Node 24.

## Coverage gates

CI fails below:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

## Live NOAA smoke tests

The real upstream profile smoke remains opt-in:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

Normal PR CI remains offline. A live multi-time smoke should only be added after manually exercising the S3 time-series path, and should stay low-frequency to avoid unnecessary upstream load.
