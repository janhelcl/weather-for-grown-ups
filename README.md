# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level queries, obeys NOMADS request pacing, caches immutable forecast slices, and returns structured values suitable for agents.

## First vertical slice

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --run 2026-08-19T06:00:00Z \
  --valid 2026-08-19T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500
```

Flow: CLI/MCP → typed profile query → variable expansion + forecast-hour planning → NOAA NOMADS Grib Filter → 11-second cross-process request gate → content-addressed GRIB2 cache → `wgrib2 -s -lon` extraction → normalized structured result.

## Requirements

- Node.js 20+
- `wgrib2` on `PATH` (or set `WGRIB2_PATH`)

`wgrib2` is deliberately an infrastructure dependency rather than reimplementing GRIB2 decoding in TypeScript.

## Development

```bash
npm install
npm test
npm run typecheck
npm run dev -- profile --help
npm run mcp
```

## NOMADS pacing

All physical NOMADS downloads pass through a file-backed cross-process limiter. The default cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second guidance. Cache hits do not consume the limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- explicit GFS run + valid-time → forecast-hour planning
- pressure-level temperature, RH, U/V wind
- derived wind speed/direction
- deterministic NOMADS query planning
- 11 s cross-process NOMADS limiter
- immutable GRIB cache
- `wgrib2 -s -lon` point extraction adapter, including 0..360 longitude normalization
- CLI `profile` command
- MCP `get_gfs_profile` with structured output

Next:

1. resolve `run: latest` without wasteful NOMADS traffic
2. broaden the variable/level catalog
3. integration-test against real GFS GRIB samples
4. add time-series queries
5. add bounded-area summaries
6. add an alternate cloud/S3 source if useful
