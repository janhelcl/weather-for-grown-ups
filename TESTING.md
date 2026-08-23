# Testing

The default WFG test suite is intentionally deterministic and offline. Unit/integration tests do not contact NOAA unless they explicitly opt into the separate live-test scripts.

## Normal verification

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:smoke
npm run pack:check
```

CI runs the main verification matrix on Node.js 20 and 24, enforces coverage gates, dry-runs the npm package, and builds/smokes the production Docker image including bundled `wgrib2` and the Streamable HTTP MCP entrypoint.

## Layers covered

- Query schema boundaries, timezone handling, `latest`/`latest_complete`/explicit run selectors, source defaults, authoritative GFS pressure-level validation, point/batch/transect/area bounds, and response-size guards.
- Variable/field/diagnostic catalog metadata, source-vs-output units, raw dependencies, vertical/temporal semantics, compact search and agent-facing serialization.
- Full configured GFS pressure-level list, including fractional upper-atmosphere levels.
- Forecast-hour validation, native GFS cadence, time-range intersection, and 384-hour horizon.
- Bounded asynchronous mapping, stable output ordering, and failure propagation.
- Latest-complete and query-aware newest-available run discovery, caching, eligible-cycle bounds, exact field availability, and range coverage.
- NOAA AWS `.idx` parsing, exact GRIB message selection, byte-range planning, slice caching, concurrent in-flight deduplication, and coordinate-independent reuse.
- NOMADS URL planning, geographic subset behavior, exact pressure/non-isobaric selection, cross-process 11-second pacing, caching, and failure paths.
- `wgrib2` point and area decoding, missing-data behavior, longitude normalization, command-runner failures, and exact-message checks.
- Single-point profiles across NOMADS and S3, derived pressure-level variables, exact non-isobaric field semantics, and completeness rejection.
- Pressure-layer, whole-profile, and parcel diagnostics, including deterministic meteorology mechanics and independent golden-reference cases.
- Batched points, one shared S3 slice, input-order preservation, bounded local decoding concurrency, and shared cache semantics.
- Great-circle transects composed over the batch primitive, sample geometry, distance ordering, and response contracts.
- Native point time series and multi-point time series, one-cycle resolution, cadence around `f120`, bounded forecast concurrency, and step/sample guards.
- Run-to-run comparison, newest-minus-older deltas, circular wind-direction deltas, and interval comparability rules.
- Bounded area summaries, exact raw-field selection, grid-size rejection, unit normalization, min/max/unweighted mean, percentiles, threshold fractions, extrema locations, and provenance.
- Shared CLI/MCP schemas and handler mappings across catalog, point, diagnostic, batch, transect, time-series, comparison, and area tools.
- Streamable HTTP MCP negotiation with the official MCP client while external network access remains blocked.
- Compiled CLI smoke coverage for every public command on both supported Node versions.

## Coverage gates

CI fails below:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

## Network isolation

Normal tests install a global network guard so accidental external `fetch` calls fail immediately. The HTTP MCP transport test narrowly permits loopback access only; it still cannot contact NOAA.

This separation is deliberate: deterministic CI answers whether WFG itself is correct, while the live suite answers whether current upstream data/access assumptions still hold.

## Live NOAA integration

```bash
npm run test:live:all
```

The expanded suite covers AWS batch/time-series/transect/parcel behavior and a rich NOMADS area query. It runs weekly on Monday at 05:17 UTC plus manual dispatch, never as a normal PR/main gate.

See [LIVE_SMOKE.md](LIVE_SMOKE.md) for the exact live coverage, Docker test environment, pacing, and failure-triage policy.
