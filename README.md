# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level and non-isobaric field queries, manages upstream access constraints, caches immutable forecast slices, and returns structured values suitable for agents.

## Discover the atmospheric catalog

```bash
wfg catalog
wfg catalog --json
```

MCP exposes the same information through `get_gfs_catalog`. WFG only accepts pressure levels published by the GFS 0.25° isobaric product, including fractional upper-atmosphere levels down to 0.01 hPa. An arbitrary level such as 842 hPa is rejected before any network request.

Supported pressure-level variables include temperature, relative humidity, U/V wind, geopotential height, specific humidity, pressure/geometric vertical velocity, absolute vorticity, total cloud cover, cloud-water mixing ratio, ozone mixing ratio, plus derived wind speed/direction.

The catalog also exposes non-isobaric fields with explicit vertical and temporal semantics:

- surface pressure, surface geopotential height, surface temperature, gust, surface CAPE/CIN, and boundary-layer height
- 2 m temperature, relative humidity, specific humidity, and dew point
- U/V and derived wind at 10, 20, 30, 40, 50, 80, and 100 m above ground
- 80 m temperature, specific humidity, and pressure; 100 m temperature
- accumulated total precipitation, with its exact GFS forecast-hour accumulation interval
- whole-atmosphere products including precipitable water, cloud water, relative humidity, total ozone, and cloud work function
- low/middle/high and whole-atmosphere cloud cover, including both instantaneous and forecast-window-average products where GFS publishes both
- cloud ceiling, convective cloud base/top pressure, low/middle/high cloud base/top pressure, low/middle/high cloud-top temperature, convective cloud cover, and boundary-layer cloud cover

Named cloud layers and named cloud levels are modeled separately from pressure surfaces and height-above-ground levels. Forecast-window averages are also distinct from instantaneous values and accumulations; their exact start/end forecast hours and UTC timestamps are returned with the value.

The catalog distinguishes source units from normalized output units. If a requested variable/level combination or exact non-isobaric field is absent from a GFS file, WFG fails with the missing field rather than returning a partial result. Some interval products are not present in the analysis (`f000`) file, so asking for them at that valid time intentionally fails rather than substituting a different temporal product.

## Point query

Pressure profile:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height,wind \
  --levels 1000,925,850,700,500
```

Fields-only query:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --fields temperature_2m,wind_10m,low_cloud_cover,low_cloud_base_pressure,precipitable_water \
  --json
```

Pressure-level variables and non-isobaric fields can be requested together in the same call by providing `--vars`, `--levels`, and `--fields`.

Non-isobaric results are records with three explicit pieces of semantics: `level`, `temporal`, and normalized `values`. For example, `total_precipitation` is returned with `temporal.type="accumulation"`, while `low_cloud_base_pressure` is returned with `temporal.type="average"`; both interval-valued products include start/end forecast hours and start/end UTC timestamps.

The run defaults to `latest`, meaning the newest GFS cycle whose already-published data can satisfy the requested valid time and exact field selection. Use `--run latest_complete` to force the newest cycle published through `f384`, or pass an explicit run timestamp for reproducibility. `wfg latest` reports the newest `f384`-complete cycle.

## Batched point query

When several locations need the same atmospheric selection at the same valid time, use one batch rather than independent point calls:

```bash
wfg points \
  --point 50.08,14.43 \
  --point 45.80,11.70 \
  --point 46.24,13.18 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --fields wind_10m,low_cloud_cover,cloud_ceiling \
  --json
```

MCP exposes the same primitive as `get_gfs_points`. A batch accepts up to 50 points, preserves input ordering, resolves `latest` once for the shared selection, and returns the requested/grid point plus the same normalized pressure and non-isobaric results used by the single-point surface.

Batched points are intentionally **S3-only**. The selected pressure/non-isobaric GRIB messages are downloaded once with HTTP byte ranges, then `wgrib2` samples that local slice at every requested coordinate. Local point decoding is bounded to eight concurrent operations. This avoids multiple NOMADS requests and therefore does not consume the NOMADS courtesy limiter per point.

The batch-level `source.cacheHit` is true only when the shared selected-message slice was already cached before the batch; a newly downloaded slice reports false even though subsequent points reuse it in-process.

## Point time series

```bash
wfg timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --from 2026-08-20T06:00:00Z \
  --to 2026-08-22T18:00:00Z \
  --fields temperature_2m,wind_10m,low_cloud_cover,precipitable_water \
  --json
```

Time series returns every native GFS output inside the requested range: hourly through forecast hour 120 and every three hours afterwards. It defaults to the S3 byte-range source and processes at most four forecast files concurrently. A default `maxSteps=160` guard prevents accidentally producing very large tool responses; callers can raise it up to the full 209 native GFS outputs.

With `run=latest`, time-series resolution chooses one newest eligible run initialized at or before the requested range start, verifies the exact requested fields at the first and last native forecast steps, and requires the range to fit inside the 384-hour forecast horizon. This avoids mixing model cycles inside one series while still using fresher partially published runs when they already cover the requested window.

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

Area summaries intentionally remain pressure-level-only for now: Grib Filter crops the requested region before transfer, then `wgrib2` computes the statistics locally. A conservative 50,000-grid-point default guard bounds the requested area. Antimeridian-crossing boxes and derived/vector statistics are not supported yet.

## Two data paths

NOMADS is the default for single point queries and the area-summary path because its Grib Filter can geographically subset before transfer. Surface, height-above-ground, named-layer, and named-level selections use the same Grib Filter request as pressure levels, so all physical NOMADS downloads continue to pass through the shared courtesy limiter.

For multi-point and multi-time workflows, NOAA AWS Open Data is the natural path. The S3 adapter fetches the `.idx` inventory, identifies only requested pressure and non-isobaric GRIB messages, derives byte ranges, and downloads those messages with HTTP Range requests. Non-isobaric selectors match variable, exact vertical semantics, and exact temporal semantics, so an instantaneous cloud-cover request cannot silently select the forecast-window-average record at the same layer. Multi-point sampling reuses one selected-message slice across all coordinates.

Both data paths feed `wgrib2` and return normalized data with explicit provenance.

## Latest-run discovery

Query tools support three run selectors:

- `latest` — newest cycle that can satisfy the query with data already published on NOAA AWS Open Data
- `latest_complete` — newest cycle whose `f384.idx` marker exists
- an explicit 00Z/06Z/12Z/18Z initialization timestamp — reproducible fixed-cycle access

For a single valid time, query-aware discovery checks the exact forecast `.idx`, including pressure variable × level pairs and non-isobaric vertical/temporal semantics. That means an averaged cloud product absent from `f000` can cause discovery to step back to an older run where the same valid time is represented by a forecast file that actually contains the requested product.

For a time range, WFG chooses a single cycle at or before the requested start, checks exact field availability at the first and last native steps, and rejects ranges extending beyond the 384-hour horizon. Complete-run and query-specific discovery results are cached independently in-process for five minutes.

The standalone CLI `wfg latest` and MCP `get_latest_gfs_run` continue to report the newest **complete** (`f384`) cycle because they have no atmospheric query to satisfy.

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
npm run dev -- points --help
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

- discoverable pressure-level and non-isobaric field catalog
- query-aware newest-available run discovery plus explicit latest-f384-complete selection via NOAA AWS Open Data
- pressure-level point profiles with completeness validation
- batched same-time sampling for up to 50 points with one reusable S3 selected-message slice
- surface and height-above-ground point fields with exact-level validation
- named cloud layers/levels and whole-atmosphere column products with exact vertical semantics
- accumulation and forecast-window-average fields with explicit forecast intervals
- native-cadence point time series with bounded concurrency and step guard
- bounded raw pressure-field area min/max/unweighted mean without returning grids
- 12 raw pressure-level fields plus derived wind
- surface diagnostics plus 2/10/20/30/40/50/80/100 m fields and derived winds
- instantaneous and averaged cloud-cover layers, cloud boundaries/top temperatures, cloud ceiling, precipitable/cloud water, ozone, and cloud work function
- deterministic NOMADS geographic-subset path with 11 s cross-process limiter
- NOAA AWS `.idx` + selected-message byte-range path with reusable subset cache
- `wgrib2` point extraction for isobaric/non-isobaric named-layer and temporal semantics plus area statistics adapters
- CLI `catalog`, `latest`, `profile`, `points`, `timeseries`, and `area`
- MCP `get_gfs_catalog`, `get_latest_gfs_run`, `get_gfs_profile`, `get_gfs_points`, `get_gfs_timeseries`, and `summarize_gfs_area`
- shared CLI/MCP result contracts and comprehensive deterministic offline test suite plus opt-in real NOAA profile smoke tests

Next:

1. extend bounded area summaries to non-isobaric fields and optionally add extrema locations/percentiles
2. add a pressure-level transect/cross-section primitive
3. add a live non-isobaric/time-series/batch smoke after the S3 path has been exercised manually
