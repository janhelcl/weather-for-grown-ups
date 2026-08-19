# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level queries, manages upstream access constraints, caches immutable forecast slices, and returns structured values suitable for agents.

## Discover the atmospheric catalog

```bash
wfg catalog
wfg catalog --json
```

MCP exposes the same information through `get_gfs_catalog`. The pressure-level catalog is explicit: WFG only accepts pressure levels published by the GFS 0.25° isobaric product, including fractional upper-atmosphere levels down to 0.01 hPa. An arbitrary level such as 842 hPa is rejected before any network request.

Currently supported pressure-level variables:

- `temperature` -> `temperatureC`
- `relative_humidity` -> `relativeHumidityPct`
- `u_wind`, `v_wind`
- `wind` -> derived speed + meteorological direction
- `geopotential_height`
- `specific_humidity`
- `vertical_velocity` (pressure coordinates, Pa/s)
- `geometric_vertical_velocity` (m/s)
- `absolute_vorticity`
- `total_cloud_cover`
- `cloud_water_mixing_ratio`
- `ozone_mixing_ratio`

The catalog distinguishes source units from normalized output units. Not every variable exists at every published pressure level; if a requested variable/level combination is absent from a GFS file, WFG fails with the exact missing fields rather than returning a partial profile.

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

Time series returns every native GFS output inside the requested range: hourly through forecast hour 120 and every three hours afterwards. It defaults to the S3 byte-range source and processes at most four forecast files concurrently. A default `maxSteps=160` guard prevents accidentally producing very large tool responses; CLI callers can raise it up to the full 209 native GFS outputs with `--max-steps`.

## Two data paths

NOMADS remains the default for single profiles because its Grib Filter can geographically subset a point-sized region and therefore transfers little data:

```bash
wfg profile ... --source nomads
```

For multi-time workflows, NOAA AWS Open Data is the default:

```bash
wfg profile ... --source s3
wfg timeseries ... --source s3
```

The S3 path fetches the small `.idx` inventory, identifies only requested variable/pressure GRIB messages, derives their byte ranges, and downloads those messages with HTTP Range requests. Each selected GRIB message contains the global grid, so it usually transfers more bytes than NOMADS for a single point, but it avoids NOMADS pacing and its cached field subset can answer any point on that grid.

Both paths feed the same `wgrib2 -s -lon` decoder and return the same normalized atmospheric fields with explicit provenance.

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
npm run mcp
```

Opt-in real upstream profile smoke tests:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

They are intentionally excluded from normal CI.

## NOMADS pacing

All physical NOMADS downloads pass through a file-backed cross-process limiter. The default cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second guidance. Cache hits do not consume the limiter. S3 access is independent of this limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- discoverable pressure-level variable/level catalog
- automatic latest-complete-run discovery via NOAA AWS Open Data
- pressure-level point profiles with completeness validation
- native-cadence point time series with bounded concurrency and step guard
- 12 raw pressure-level fields plus derived wind
- deterministic NOMADS geographic-subset path with 11 s cross-process limiter
- NOAA AWS `.idx` + selected-message byte-range path with reusable subset cache
- `wgrib2 -s -lon` point extraction
- CLI `catalog`, `latest`, `profile`, and `timeseries`
- MCP `get_gfs_catalog`, `get_latest_gfs_run`, `get_gfs_profile`, and `get_gfs_timeseries`
- comprehensive deterministic offline test suite plus opt-in real NOAA profile smoke tests

Next:

1. add bounded-area summaries
2. model surface/height/accumulation fields as separate level/time semantics
3. add a live time-series smoke after the S3 path has been exercised manually
