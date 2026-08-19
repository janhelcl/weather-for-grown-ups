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

- Query schema boundaries, timezone handling, `run: latest` defaulting, and source selection.
- GFS run validation, forecast-hour cadence, and 384-hour horizon.
- Latest-complete-run cycle flooring, backward search, UTC date rollover, TTL caching, and failure behavior.
- NOAA AWS complete-run marker URL construction and HEAD-response handling.
- wgrib2 `.idx` parsing, byte offsets, submessage/duplicate-offset handling, inclusive range derivation, and open-ended final ranges.
- S3 subset fetching, HTTP 206 enforcement, GRIB signature validation, canonical subset cache keys, cached index reuse, and concurrent in-process deduplication.
- Variable catalog expansion and dependency deduplication.
- NOMADS Grib Filter URL construction, canonical ordering, and geographic clipping.
- Wind vector derivation and normalization invariants.
- `wgrib2` output parsing, command invocation, and failure behavior.
- Cross-caller file locking, stale-lock recovery, failure cleanup, and the 11-second default courtesy interval.
- NOMADS GRIB cache hits, concurrent request deduplication, HTTP failures, invalid upstream content, and atomic writes.
- End-to-end profile orchestration with fake source/decoder/latest-run dependencies, including NOMADS vs S3 provenance, units, explicit-vs-latest run selection, level filtering, and derived wind.
- MCP profile and latest-run success/error response mapping.
- Compiled CLI smoke tests on Node 20 and Node 24.

## Coverage gates

The V8 coverage job includes production code under `src/` except the process-boundary entrypoints `src/cli.ts` and `src/mcp.ts`. Those entrypoints are covered by compilation and smoke checks; their underlying logic is tested through the core service and MCP handlers.

CI fails below these global thresholds:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

## Live NOAA smoke tests

The real upstream smoke test is deliberately opt-in:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

It requires network access and a working `wgrib2` binary. The first form uses the normal NOMADS path; the second uses NOAA AWS `.idx` + Range access. Both first resolve the latest **complete** GFS cycle and then request the same small Prague pressure profile.

Do not add this command to normal PR CI. If we later schedule it, it should remain low-frequency and use production access/caching behavior.
