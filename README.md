# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core with equal CLI and MCP surfaces.

WFG exposes the atmospheric model rather than trying to interpret it for a particular activity. It normalizes NOAA/GFS naming, validates vertical and temporal semantics, selects only the requested GRIB messages, manages upstream pacing and caching, computes deterministic physical diagnostics locally, and returns structured values suitable for agents.

## 0.1 scope

The 0.1 release surface is now feature-complete around deterministic GFS 0.25° access:

- point profiles for pressure-level and non-isobaric fields;
- searchable atmospheric catalog;
- pressure-layer, whole-profile, and explicit parcel diagnostics;
- native-cadence composed diagnostic time series for those diagnostic families;
- multi-point queries and native-cadence field time series;
- multi-point time series;
- run-to-run comparison;
- great-circle pressure-level transects;
- bounded area statistics including percentiles, threshold fractions, and extrema locations;
- NOAA NOMADS and AWS Open Data access paths;
- local stdio MCP and remotely hostable Streamable HTTP MCP;
- deterministic offline CI plus a low-frequency live NOAA integration suite.

Ensembles/GEFS remain intentionally outside the 0.1 deterministic-GFS scope.

## Install

### Docker — recommended

Docker is the zero-host-dependency route because the image includes Node.js 24 and `wgrib2 3.8.0`.

Build from source:

```bash
docker build -t weather-for-grown-ups .
docker run --rm weather-for-grown-ups catalog --search cloud --json
```

Tagged releases are designed to publish the same runtime to GHCR:

```bash
docker run --rm ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 catalog --search cloud --json
```

### npm

The npm package provides `wfg`, `wfg-mcp`, and `wfg-mcp-http`. The npm route intentionally does **not** install the native GRIB decoder; `wgrib2` must already be available on `PATH` or through `WGRIB2_PATH`.

```bash
npm install -g weather-for-grown-ups
wfg --help
```

See [INSTALL.md](INSTALL.md) for Docker, npm, stdio MCP, Streamable HTTP MCP, hosted security settings, and release details.

## CLI

Discover the catalog before constructing a query:

```bash
wfg catalog
wfg catalog --search "cloud base" --sections fields --json
```

A point profile:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --fields temperature_2m,wind_10m,low_cloud_cover \
  --json
```

Explicit parcel diagnostics:

```bash
wfg parcel \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

The same parcel diagnostics across native forecast times:

```bash
wfg diagnostic-timeseries \
  --kind parcel \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-20T09:00:00Z \
  --end 2026-08-20T18:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

A transect:

```bash
wfg transect \
  --start 50.08,14.43 \
  --end 46.24,13.18 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --samples 15 \
  --json
```

A richer area summary:

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-20T12:00:00Z \
  --field temperature_2m \
  --percentiles 10,50,90 \
  --gte 20 \
  --extrema-locations \
  --json
```

### CLI command surface

| Command | Purpose |
| --- | --- |
| `catalog` | Browse/search variables, fields, diagnostics, parcel definitions, semantics and units |
| `latest` | Resolve the newest GFS cycle published through `f384` |
| `profile` | One point/time pressure profile and/or non-isobaric fields |
| `layer` | Deterministic diagnostics between two pressure surfaces |
| `profile-diagnostics` | Freezing-level crossings and sampled inversion layers |
| `parcel` | Explicit surface/mixed-layer/most-unstable parcel LCL/LFC/EL/CAPE/CIN |
| `diagnostic-timeseries` | Native-cadence layer/profile/parcel diagnostics across a valid-time range |
| `points` | Same field selection for up to 50 points from one shared S3 slice |
| `transect` | 2–50 great-circle samples across explicit pressure levels |
| `timeseries` | One-point native GFS forecast-step field series |
| `points-timeseries` | Multi-point native GFS series with shared slices per step |
| `compare-runs` | Same point/valid time across 2–6 consecutive GFS cycles |
| `area` | Bounded raw-field min/max/mean plus optional distribution statistics |

Every query command supports JSON output. The CLI and MCP surfaces call the same services and validate against the same schemas.

## MCP

### stdio

```bash
wfg-mcp
```

or with the Docker image:

```bash
docker run -i --rm ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 mcp
```

### Streamable HTTP

```bash
wfg-mcp-http
```

The safe default binds `127.0.0.1:3000`; the MCP endpoint is `/mcp` and `GET /healthz` is the process health check. Non-loopback binds require an explicit `WFG_MCP_ALLOWED_HOSTS` allowlist. See [INSTALL.md](INSTALL.md) before exposing the server remotely.

Current MCP tools:

- `get_gfs_catalog`
- `search_gfs_catalog`
- `get_latest_gfs_run`
- `get_gfs_profile`
- `get_gfs_layer_diagnostics`
- `get_gfs_profile_diagnostics`
- `get_gfs_parcel_diagnostics`
- `get_gfs_diagnostic_timeseries`
- `get_gfs_points`
- `get_gfs_transect`
- `get_gfs_timeseries`
- `get_gfs_points_timeseries`
- `compare_gfs_runs`
- `summarize_gfs_area`

## Atmospheric catalog and semantics

WFG only accepts pressure levels actually published by the GFS 0.25° isobaric product. Unsupported arbitrary levels are rejected before a network request.

The catalog includes raw GFS pressure-level variables and deterministic local derivations such as wind, dew point, potential temperature, mixing ratio, virtual temperature, moist-air density, wet-bulb temperature, and equivalent potential temperature. It also declares pressure-layer diagnostics, whole-profile diagnostics, parcel definitions, and non-isobaric fields.

Non-isobaric fields preserve explicit vertical semantics (`surface`, height above ground, named layer, named level) and temporal semantics (`instantaneous`, `accumulation`, `average`). WFG will fail rather than silently substitute a different level or time-window product.

Use:

```bash
wfg catalog --search precipitation
wfg catalog --search cloud --sections fields --temporal average
```

See [CATALOG_SEARCH.md](CATALOG_SEARCH.md) for the discovery contract.

## Deterministic diagnostics

WFG deliberately separates raw model fields from deterministic physical transforms.

Pressure-layer diagnostics currently include environmental temperature lapse rate, vector wind shear, and potential-temperature gradient. Whole-profile diagnostics include all sampled 0 °C crossings and sampled temperature-inversion layers. Parcel calculations require an explicit parcel definition: `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa`.

The single-time diagnostic tools return sampled/input values alongside derived values for auditability. The diagnostic time-series composition repeats those existing calculations across native GFS outputs using one fixed model run and one fixed diagnostic selection. Parcel series keep parcel start, LCL/LFC/EL, CAPE and CIN but omit the repeated full parcel path; the single-time parcel surface remains the detailed audit path.

Meteorological formulas have a golden-reference validation layer against published MetPy reference cases; see [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md). See [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) for time-series semantics and examples.

## Spatial and temporal composition

Multi-point queries reuse one selected-message S3 slice across all requested coordinates. Multi-point time series repeat that reuse once per forecast step. Transects are the same batch primitive composed over evenly spaced great-circle coordinates.

Diagnostic time series are a different composition over existing single-time diagnostic services. WFG resolves one query-aware run for the complete valid-time range, walks the native GFS forecast timeline, and evaluates one fixed layer/profile/parcel selection at each step. S3 is the default data path for this multi-time operation; NOMADS remains available explicitly and still uses the shared 11-second courtesy limiter.

Area queries are intentionally different: they use a bounded NOMADS geographic subset and compute statistics locally without returning the raw grid. Available statistics are min/max/unweighted grid-point mean plus optional percentiles, threshold fractions in normalized output units, and representative extrema coordinates with tie counts.

Detailed contracts:

- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md)
- [TRANSECT.md](TRANSECT.md)
- [AREA_SUMMARY.md](AREA_SUMMARY.md)
- [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md)
- [RUN_COMPARISON.md](RUN_COMPARISON.md)

## Run selection

Query tools support:

- `latest` — newest GFS cycle whose already-published data can satisfy the specific query;
- `latest_complete` — newest cycle published through `f384`;
- explicit 00Z/06Z/12Z/18Z initialization timestamps for reproducibility.

Query-aware `latest` checks the actual requested field/diagnostic dependencies and valid time/range, so WFG does not choose a newer run that has not published enough data yet. For diagnostic time series the resolution happens once for the complete time range, then that explicit cycle is used for every step. The standalone `wfg latest` / `get_latest_gfs_run` surface reports the newest complete cycle because it has no query to satisfy.

## NOAA data paths

**NOMADS Grib Filter** is the default for single-point requests and the bounded-area path because it can subset geographically before transfer. Every physical NOMADS request passes through one file-backed cross-process limiter with an **11-second post-request cooldown**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. Cache hits do not consume the limiter.

**NOAA AWS Open Data** is used for efficient batch, transect, field time-series, diagnostic time-series, multi-point time-series, and run-comparison work. WFG reads the `.idx`, calculates byte ranges for only the selected GRIB messages, downloads those ranges, caches immutable slices, and samples them locally with `wgrib2`.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Testing

Normal CI is deterministic and does not contact NOAA:

```bash
npm test
npm run typecheck
npm run build
npm run test:smoke
```

The expanded real-upstream suite is separate:

```bash
npm run test:live:all
```

It exercises AWS S3 batch/time-series/transect/parcel paths and a rich NOMADS area request. GitHub Actions runs it on a deliberately low-frequency weekly schedule (Monday 05:17 UTC) and also supports manual dispatch. Normal PR/main CI remains offline. See [LIVE_SMOKE.md](LIVE_SMOKE.md) and [TESTING.md](TESTING.md).

## Documentation map

- [INSTALL.md](INSTALL.md) — installation, Docker/npm distribution, stdio/HTTP MCP, hosting and release behavior
- [ARCHITECTURE.md](ARCHITECTURE.md) — core boundaries, data paths, caching and surface design
- [CATALOG_SEARCH.md](CATALOG_SEARCH.md) — atmospheric discovery/search semantics
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — native-cadence layer/profile/parcel diagnostic composition
- [TRANSECT.md](TRANSECT.md) — great-circle cross-section primitive
- [AREA_SUMMARY.md](AREA_SUMMARY.md) — bounded area selection and statistics
- [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md) — percentiles, thresholds and extrema semantics
- [RUN_COMPARISON.md](RUN_COMPARISON.md) — cycle comparison and delta rules
- [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) — independent golden meteorology validation
- [TESTING.md](TESTING.md) — deterministic test architecture
- [LIVE_SMOKE.md](LIVE_SMOKE.md) — real NOAA integration suite and schedule

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run dev -- catalog --search cloud
npm run mcp
npm run mcp:http
```

The executable CLI is intentionally thin: `src/cli.ts` creates one Commander root and registers command groups from `src/cli/`. Business logic lives in the shared core rather than in CLI or MCP handlers.

## Non-goals

WFG returns model data and deterministic physical derivations. It does not provide activity-specific suitability scores, safety advice, or hidden meteorological interpretation.

For the next capability phase, the highest-value expansion is ensemble uncertainty rather than more deterministic one-off diagnostics. GEFS work remains intentionally deferred until explicitly started.
