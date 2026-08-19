# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level queries, manages upstream access constraints, caches immutable forecast slices, and returns structured values suitable for agents.

## First vertical slice

The default is the latest **complete** GFS cycle, so callers do not need to know model run times:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500
```

Use `wfg latest` to inspect the resolved cycle. Pass `--run 2026-08-19T06:00:00Z` when reproducibility or an older run matters.

## Two data paths

NOMADS remains the default because its Grib Filter can geographically subset a point-sized region and therefore transfers little data:

```bash
wfg profile ... --source nomads
```

For workflows where NOMADS's request pacing is the bottleneck, use NOAA AWS Open Data:

```bash
wfg profile ... --source s3
```

The S3 path fetches the small `.idx` inventory, identifies only the requested variable/pressure GRIB messages, derives their byte ranges, and downloads those messages with HTTP Range requests. It does **not** download the whole GFS file. Because each selected GRIB message still contains the global grid, S3 usually transfers more bytes than NOMADS for a single point, but it avoids the NOMADS 10-second scripted-request constraint and the cached subset can be reused for any point on that forecast field.

Both paths feed the same `wgrib2 -s -lon` decoder and return the same result schema with explicit provenance.

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

Opt-in real upstream smoke tests:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

They resolve the latest complete cycle through NOAA AWS, make one Prague pressure-profile request through the selected production data path, decode it with real `wgrib2`, and assert the returned shape. They are intentionally excluded from normal CI.

## NOMADS pacing

All physical NOMADS downloads pass through a file-backed cross-process limiter. The default cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second guidance. Cache hits do not consume the limiter. S3 access is independent of this limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- automatic latest-complete-run discovery via NOAA AWS Open Data
- explicit GFS run + valid-time → forecast-hour planning
- pressure-level temperature, RH, U/V wind
- derived wind speed/direction
- deterministic NOMADS query planning
- 11 s cross-process NOMADS limiter
- immutable NOMADS GRIB cache
- NOAA AWS `.idx` parsing + selected-message HTTP byte-range fetch + subset cache
- `wgrib2 -s -lon` point extraction adapter, including 0..360 longitude normalization
- CLI `latest` and `profile` commands with `--source nomads|s3`
- MCP `get_latest_gfs_run` and `get_gfs_profile` with structured provenance
- deterministic offline test suite plus opt-in real NOAA smoke tests

Next:

1. broaden the variable/level catalog
2. add time-series queries, preferentially using the S3 range source
3. add bounded-area summaries
