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

- Query schema boundaries, timezone handling, `latest`/`latest_complete`/explicit run selectors, source defaults, authoritative GFS pressure-level validation, area bbox rules, and context/work guards.
- Variable catalog metadata, source-vs-output units, derived dependencies, and agent-facing catalog serialization.
- Full configured GFS pressure-level list, including fractional upper-atmosphere levels.
- GFS run validation, single-time forecast-hour validation, full native cadence, range intersection, and 384-hour horizon.
- Bounded asynchronous mapping, stable output ordering, and failure propagation.
- Latest-complete-run discovery and query-aware newest-available discovery, independent TTL caching, eligible-cycle bounds, and time-range horizon checks.
- NOAA AWS `.idx` parsing and availability probing, including exact variable × pressure-level completeness and exact non-isobaric vertical/temporal semantics.
- NOAA AWS byte-range selection, subset caching, and failure paths.
- NOMADS point/area URL planning, pacing, cache behavior, and failure paths.
- `wgrib2` parsing for all supported raw pressure variables and point invocation behavior.
- `wgrib2` area-statistics parsing, longitude normalization, defined-grid counts, missing-data behavior, and command-runner failures.
- Point profile orchestration across NOMADS/S3, query-aware run requirements, all canonical raw output mappings, no-data behavior, and rejection of partial decoded profiles.
- Point time-series orchestration, native cadence around f120, single-cycle query-aware resolution, source/grid consistency, bounded concurrency, cache-hit propagation, and max-step rejection.
- Area-summary orchestration, query-aware pressure-field run requirements, estimated grid-size rejection before network access, temperature normalization, raw-unit preservation, provenance, and explicit unweighted-mean semantics.
- Shared CLI/MCP result contracts plus MCP catalog/latest/profile/time-series/area success and error mappings.
- Compiled CLI smoke tests on Node 20 and Node 24, including all five commands.

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

Normal PR CI remains offline. Live time-series/area checks should only be added after manual upstream exercises and should stay low-frequency to avoid unnecessary upstream load.
