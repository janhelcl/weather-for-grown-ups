# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level queries, obeys NOMADS request pacing, caches immutable forecast slices, and returns structured values suitable for agents.

## First vertical slice

The default is now the latest **complete** GFS cycle, so callers do not need to know model run times:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500
```

Use `wfg latest` to inspect the resolved cycle. Pass `--run 2026-08-19T06:00:00Z` when reproducibility or an older run matters.

Flow: CLI/MCP → typed profile query → latest-run resolution when needed → variable expansion + forecast-hour planning → NOAA NOMADS Grib Filter → 11-second cross-process request gate → content-addressed GRIB2 cache → `wgrib2 -s -lon` extraction → normalized structured result.

## Latest-run discovery

`latest` means the newest **complete** GFS 0.25° run. WFG checks NOAA's public AWS Open Data copy for the run's `f384.idx` marker, starting with the current 6-hour cycle and walking backwards. This avoids spending NOMADS requests on run discovery and avoids selecting a partially published cycle. Results are cached in-process for five minutes.

## Requirements

- Node.js 20+
- `wgrib2` on `PATH` (or set `WGRIB2_PATH`)

`wgrib2` is deliberately an infrastructure dependency rather than reimplementing GRIB2 decoding in TypeScript.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run test:smoke
npm run dev -- latest
npm run dev -- profile --help
npm run mcp
```

An opt-in real upstream smoke test is available with:

```bash
npm run test:live
```

It resolves the latest complete cycle through NOAA AWS, makes one small Prague pressure-profile request through the normal NOMADS limiter/cache, decodes it with real `wgrib2`, and asserts the returned shape. It is intentionally excluded from normal CI.

## NOMADS pacing

All physical NOMADS downloads pass through a file-backed cross-process limiter. The default cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second guidance. Cache hits do not consume the limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- automatic latest-complete-run discovery via NOAA AWS Open Data
- explicit GFS run + valid-time → forecast-hour planning
- pressure-level temperature, RH, U/V wind
- derived wind speed/direction
- deterministic NOMADS query planning
- 11 s cross-process NOMADS limiter
- immutable GRIB cache
- `wgrib2 -s -lon` point extraction adapter, including 0..360 longitude normalization
- CLI `latest` and `profile` commands
- MCP `get_latest_gfs_run` and `get_gfs_profile` with structured output
- deterministic offline test suite plus opt-in real NOAA smoke test

Next:

1. broaden the variable/level catalog
2. add time-series queries
3. add bounded-area summaries
4. consider direct S3 data access as an alternate source
