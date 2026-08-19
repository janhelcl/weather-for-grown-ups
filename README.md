# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level queries, manages upstream access constraints, caches immutable forecast slices, and returns structured values suitable for agents.

## Discover the atmospheric catalog

```bash
wfg catalog
wfg catalog --json
```

MCP exposes the same information through `get_gfs_catalog`. WFG only accepts pressure levels published by the GFS 0.25° isobaric product, including fractional upper-atmosphere levels down to 0.01 hPa. An arbitrary level such as 842 hPa is rejected before any network request.

Currently supported pressure-level variables include temperature, relative humidity, U/V wind, geopotential height, specific humidity, pressure/geometric vertical velocity, absolute vorticity, total cloud cover, cloud-water mixing ratio, ozone mixing ratio, plus derived wind speed/direction.

The catalog distinguishes source units from normalized output units. If a requested variable/level combination is absent from a GFS file, WFG fails with the exact missing fields rather than returning a partial profile.

## Point profile

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height,wind \
  --levels 1000,925,850,700,500
```

The run defaults to the latest **complete** GFS cycle. Use `wfg latest` to inspect it or pass `--run ...` for reproducibility.

## Point time series

```bash
wfg timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --from 2026-08-20T06:00:00Z \
  --to 2026-08-22T18:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500
```

Time series returns every native GFS output inside the requested range: hourly through forecast hour 120 and every three hours afterwards. It defaults to the S3 byte-range source and processes at most four forecast files concurrently. A default `maxSteps=160` guard prevents accidentally producing very large tool responses; callers can raise it up to the full 209 native GFS outputs.

## Bounded area summary

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-20T12:00:00Z \
  --var temperature \
  --level 850
```

MCP exposes the same primitive as `summarize_gfs_area`. It returns **min, max, and an unweighted grid-point mean** for one raw variable, one pressure level, one valid time, and one bbox. The raw grid is never returned to the agent.

Area summaries intentionally use NOMADS only in v1: Grib Filter crops the requested region before transfer, then `wgrib2` computes the statistics locally. A conservative 50,000-grid-point default guard bounds the requested area. Antimeridian-crossing boxes and derived/vector statistics are not supported yet.

## Two data paths

NOMADS is the default for single profiles and the area-summary path because its Grib Filter can geographically subset before transfer. All physical NOMADS downloads pass through the shared courtesy limiter.

For multi-time workflows, NOAA AWS Open Data is the default. The S3 path fetches the `.idx` inventory, identifies only requested variable/pressure GRIB messages, derives byte ranges, and downloads those messages with HTTP Range requests. Each selected message contains the global grid, so it usually transfers more bytes than NOMADS for a single point, but avoids NOMADS pacing and can be reused for any point on that grid.

Both data paths feed `wgrib2` and return normalized data with explicit provenance.

## Latest-run discovery

`latest` means the newest **complete** GFS 0.25° run. WFG checks NOAA's public AWS Open Data copy for the run's `f384.idx` marker, starting with the current 6-hour cycle and walking backwards. Results are cached in-process for five minutes.

## Requirements

- Node.js 20+
- `wgrib2` on `PATH` (or set `WGRIB2_PATH`)

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run test:smoke
npm run dev -- catalog
npm run dev -- latest
npm run dev -- profile --help
npm run dev -- timeseries --help
npm run dev -- area --help
npm run mcp
```

Opt-in real upstream profile smoke tests:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

They are intentionally excluded from normal CI.

## NOMADS pacing

The default NOMADS cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second scripted-request guidance. Cache hits do not consume the limiter. S3 access is independent of this limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- discoverable pressure-level variable/level catalog
- automatic latest-complete-run discovery via NOAA AWS Open Data
- pressure-level point profiles with completeness validation
- native-cadence point time series with bounded concurrency and step guard
- bounded raw-field area min/max/unweighted mean without returning grids
- 12 raw pressure-level fields plus derived wind
- deterministic NOMADS geographic-subset path with 11 s cross-process limiter
- NOAA AWS `.idx` + selected-message byte-range path with reusable subset cache
- `wgrib2` point extraction and area statistics adapters
- CLI `catalog`, `latest`, `profile`, `timeseries`, and `area`
- MCP `get_gfs_catalog`, `get_latest_gfs_run`, `get_gfs_profile`, `get_gfs_timeseries`, and `summarize_gfs_area`
- comprehensive deterministic offline test suite plus opt-in real NOAA profile smoke tests

Next:

1. model surface/height/accumulation fields as separate level/time semantics
2. optionally add extrema locations to bounded area summaries
3. add a live time-series smoke after the S3 path has been exercised manually
