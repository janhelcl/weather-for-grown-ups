# Weather for Grown Ups

Agent-native access to NOAA numerical weather models: one TypeScript core with equal CLI and MCP surfaces.

WFG exposes model data and explicit physical semantics rather than trying to interpret weather for a particular activity. It normalizes NOAA naming, validates vertical and temporal semantics, selects only requested GRIB messages, manages upstream access and caching, computes deterministic physical transforms locally, and returns structured values suitable for agents.

## Current scope

### Deterministic GFS 0.25°

The deterministic surface is feature-complete around GFS 0.25° access:

- point profiles for pressure-level and non-isobaric fields;
- searchable atmospheric catalog;
- pressure-layer, whole-profile, and explicit parcel diagnostics;
- native-cadence composed diagnostic time series;
- multi-point queries and field time series;
- multi-point time series;
- run-to-run comparison;
- great-circle pressure-level transects;
- bounded area statistics including percentiles, threshold fractions, and extrema locations;
- NOAA NOMADS and AWS Open Data access paths.

### GEFS 0.5° ensemble foundation

The ensemble surface adds model-native NOAA GEFS access without pretending GEFS is just deterministic GFS plus a member argument:

- operational atmospheric `pgrb2a` 0.5° product;
- control `c00` plus perturbed members `p01` through `p30`;
- one-point distributions at one valid time;
- native three-hour ensemble time series from one fixed model cycle;
- aligned deterministic GFS-vs-GEFS distribution comparison from one shared initialization cycle;
- raw pressure-level variable and pressure-surface selection;
- native three-hour cadence through `f384` in the current WFG contract;
- member values plus mean, population spread, extrema and caller-selected quantiles;
- optional threshold member fraction, explicitly marked as **not a calibrated probability**;
- compact time-series summaries by default, with full member trajectories only on request;
- direct NOAA AWS `.idx` byte-range access and immutable local caching.

See [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) for the model/member/time-series contract and [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) for aligned cross-model comparison semantics.

Both model families are available through local stdio MCP and remotely hostable Streamable HTTP MCP. CLI and MCP use the same core services and schemas.

## Install

### Docker — recommended

Docker is the zero-host-dependency route because the image includes Node.js 24 and `wgrib2 3.8.0`.

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

Discover the deterministic GFS catalog before constructing a query:

```bash
wfg catalog
wfg catalog --search "cloud base" --sections fields --json
```

### GFS point profile

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --fields temperature_2m,wind_10m,low_cloud_cover \
  --json
```

### GEFS ensemble at one point/time

```bash
wfg ensemble \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

The default ensemble selection is all 31 members. Use `--members c00,p01,p02,...` to request a subset.

### GEFS ensemble time series

```bash
wfg ensemble-timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

The series resolves one model cycle for the complete range. Per-step member values are omitted by default; add `--include-members` only when the full trajectories are needed.

### Compare deterministic GFS with GEFS

```bash
wfg compare-gfs-gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

`latest` resolves one shared initialization cycle that can satisfy both deterministic GFS and every requested GEFS member. The result reports the deterministic-minus-ensemble-mean difference, standardized difference, empirical member rank fractions, and whether deterministic GFS falls outside the selected member range. It does not invent an `isOutlier` threshold.

### Explicit parcel diagnostics

```bash
wfg parcel \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

### Diagnostic time series

```bash
wfg diagnostic-timeseries \
  --kind parcel \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-24T09:00:00Z \
  --end 2026-08-24T18:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

### Transect

```bash
wfg transect \
  --start 50.08,14.43 \
  --end 46.24,13.18 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --samples 15 \
  --json
```

### Area summary

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --field temperature_2m \
  --percentiles 10,50,90 \
  --gte 20 \
  --extrema-locations \
  --json
```

### CLI command surface

| Command | Purpose |
| --- | --- |
| `catalog` | Browse/search deterministic GFS variables, fields, diagnostics, parcel definitions, semantics and units |
| `latest` | Resolve the newest GFS cycle published through `f384` |
| `ensemble` | GEFS member values and distribution summary for one raw pressure-level field at one point/time |
| `ensemble-timeseries` | GEFS distribution summaries across native three-hour steps from one fixed run; optional member trajectories |
| `compare-gfs-gefs` | Deterministic GFS positioned inside an aligned GEFS member distribution from the same initialization cycle |
| `profile` | One GFS point/time pressure profile and/or non-isobaric fields |
| `layer` | Deterministic diagnostics between two GFS pressure surfaces |
| `profile-diagnostics` | Freezing-level crossings and sampled inversion layers |
| `parcel` | Explicit surface/mixed-layer/most-unstable parcel LCL/LFC/EL/CAPE/CIN |
| `diagnostic-timeseries` | Native-cadence layer/profile/parcel diagnostics across a valid-time range |
| `points` | Same GFS field selection for up to 50 points from one shared S3 slice |
| `transect` | 2–50 great-circle samples across explicit GFS pressure levels |
| `timeseries` | One-point native GFS forecast-step field series |
| `points-timeseries` | Multi-point native GFS series with shared slices per step |
| `compare-runs` | Same point/valid time across 2–6 consecutive GFS cycles |
| `area` | Bounded GFS raw-field min/max/mean plus optional distribution statistics |

Every query command supports JSON output.

## MCP

### stdio

```bash
wfg-mcp
```

or with Docker:

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
- `get_gefs_ensemble`
- `get_gefs_ensemble_timeseries`
- `compare_gfs_to_gefs`
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

## Model semantics

### Deterministic GFS

WFG only accepts pressure levels actually published by the GFS 0.25° isobaric product. Unsupported arbitrary levels are rejected before a network request.

The GFS catalog includes raw pressure-level variables and deterministic local derivations such as wind, dew point, potential temperature, mixing ratio, virtual temperature, moist-air density, wet-bulb temperature, and equivalent potential temperature. It also declares pressure-layer diagnostics, whole-profile diagnostics, parcel definitions, and non-isobaric fields.

Non-isobaric fields preserve explicit vertical semantics (`surface`, height above ground, named layer, named level) and temporal semantics (`instantaneous`, `accumulation`, `average`). WFG fails rather than silently substituting a different level or time-window product.

### GEFS

GEFS has a separate explicit catalog because the 0.5° `pgrb2a` inventory is not identical to deterministic GFS 0.25°. The current ensemble surface supports temperature, relative humidity, U/V wind components and geopotential height on the documented common pressure surfaces, with additional 300/400-hPa support for U/V wind.

Member order is canonicalized to `c00,p01,...,p30`. All members in one point result come from the same model initialization cycle and valid time. Ensemble time series additionally guarantee that every forecast step belongs to one fixed model cycle.

Cross-model comparisons preserve the distinct sampled GFS 0.25° and GEFS 0.5° grid points. They compare one raw variable in the same normalized units, same initialization cycle, and same valid time; WFG does not silently resample the two products onto a common grid for this point primitive.

## Deterministic meteorology

WFG deliberately separates raw model fields from deterministic physical transforms.

Pressure-layer diagnostics currently include environmental temperature lapse rate, vector wind shear, and potential-temperature gradient. Whole-profile diagnostics include all sampled 0 °C crossings and sampled temperature-inversion layers. Parcel calculations require an explicit parcel definition: `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa`.

Single-time diagnostic tools return sampled/input values alongside derived values for auditability. Diagnostic time series repeat those same calculations across native GFS outputs using one fixed model run and fixed diagnostic selection. Parcel series keep parcel start, LCL/LFC/EL, CAPE and CIN while the single-time parcel result remains the detailed audit path.

Meteorological formulas have golden-reference validation against published MetPy reference cases; see [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md).

## Spatial and temporal composition

GFS multi-point queries reuse one selected-message S3 slice across all requested coordinates. Multi-point time series repeat that reuse once per forecast step. Transects compose the same batch primitive over evenly spaced great-circle coordinates.

Diagnostic time series compose existing single-time diagnostic services. WFG resolves one query-aware run for the complete valid-time range, walks the native GFS forecast timeline, and evaluates one fixed diagnostic selection at each step.

Area queries use a bounded NOMADS geographic subset and compute statistics locally without returning the raw grid.

GEFS time series compose the existing one-time member-distribution service over native three-hour steps. Query-aware range resolution chooses one initialization that can satisfy the complete interval, and each underlying step receives that explicit run. Summary-only output is the default to avoid multiplying agent context by `members × forecast steps` unless the caller explicitly requests member trajectories.

The GFS-vs-GEFS comparison composes the existing deterministic GFS profile and GEFS ensemble primitives after resolving one shared cycle. The comparison layer owns alignment and descriptive distribution metrics, not a second GRIB access implementation.

## Run selection

### GFS

GFS query tools support:

- `latest` — newest cycle whose already-published data can satisfy the specific query;
- `latest_complete` — newest cycle published through `f384`;
- explicit 00Z/06Z/12Z/18Z initialization timestamps.

Query-aware `latest` checks requested dependencies and valid time/range so WFG does not choose a newer run that has not published enough data yet.

### GEFS and aligned comparison

`get_gefs_ensemble` / `wfg ensemble` support:

- `latest` — newest six-hour GEFS cycle for which every requested member exists at the required valid time;
- explicit 00Z/06Z/12Z/18Z initialization timestamps.

`get_gefs_ensemble_timeseries` / `wfg ensemble-timeseries` use the same explicit-run option. For `latest`, the resolver selects the newest cycle that starts no later than the first requested valid time and has the selected members published at both ends of the complete range. That run is then fixed across every intermediate step.

`compare_gfs_to_gefs` / `wfg compare-gfs-gefs` use a stricter aligned `latest`: the chosen cycle must contain the selected deterministic GFS field and all requested GEFS members at the same valid time. Both model calls then receive that explicit shared run.

The current WFG GEFS contract requires native three-hour output and caps forecast hour at `f384`.

## NOAA data paths

**NOMADS Grib Filter** is the default for deterministic GFS single-point requests and the bounded-area path because it can subset geographically before transfer. Every physical NOMADS request passes through one file-backed cross-process limiter with an **11-second post-request cooldown**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. Cache hits do not consume the limiter.

**NOAA AWS Open Data** is used for deterministic GFS batch/transect/time-series/run-comparison work, aligned GFS-vs-GEFS comparison, and GEFS member access. WFG reads `.idx` inventories, calculates byte ranges for selected GRIB messages, downloads only those ranges, caches immutable slices, and samples locally with `wgrib2`.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Testing

Normal CI is deterministic and does not contact NOAA:

```bash
npm test
npm run typecheck
npm run build
npm run test:smoke
```

The real-upstream suite is separate:

```bash
npm run test:live:all
```

It exercises deterministic GFS AWS/NOMADS paths plus a small GEFS control-plus-two-member point query, two-step ensemble time series, and aligned deterministic GFS-vs-GEFS comparison. GitHub Actions runs it on a deliberately low-frequency weekly schedule and also supports manual dispatch. Normal PR/main CI remains offline.

## Documentation map

- [INSTALL.md](INSTALL.md) — installation, Docker/npm distribution, stdio/HTTP MCP, hosting and release behavior
- [ARCHITECTURE.md](ARCHITECTURE.md) — core boundaries, data paths, caching and surface design
- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — GEFS model/member contract, point/time-series distribution semantics and examples
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — aligned deterministic GFS vs GEFS distribution semantics
- [CATALOG_SEARCH.md](CATALOG_SEARCH.md) — deterministic GFS atmospheric discovery/search semantics
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

WFG returns model data, ensemble-member distributions, descriptive cross-model comparisons, and deterministic physical derivations. It does not provide activity-specific suitability scores, safety advice, hidden meteorological interpretation, or present raw ensemble/member-rank evidence as calibrated probabilities or uncertainty.
