# Weather for Grown Ups

Agent-native access to NOAA numerical weather models: one TypeScript core with equal CLI and MCP surfaces.

WFG exposes model data and explicit physical semantics rather than trying to interpret weather for a particular activity. It normalizes NOAA naming, validates vertical and temporal semantics, selects only requested GRIB messages, manages upstream access and caching, computes physical transforms locally, and returns structured values suitable for agents.

## One atmospheric core, model-native results

GFS and GEFS now share a common operation and meteorology layer. The design rule is:

> **Unify operations and physics; preserve model semantics.**

`profile`, `timeseries`, and `layer` are atmospheric operations rather than separate implementations per model. Deterministic GFS and ensemble GEFS feed normalized pressure profiles into the same diagnostic kernels, but their result contracts remain different where the science is different:

- GFS returns deterministic values;
- GEFS returns member distributions and optional memberwise audit data;
- nonlinear diagnostics are evaluated **per GEFS member before aggregation**;
- WFG never disguises a raw member fraction or spread as calibrated probability/uncertainty.

The model capability catalog makes unsupported combinations explicit rather than pretending every model has identical inventory or products. This also gives future model adapters a stable integration boundary.

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
- multi-variable, multi-level ensemble pressure profiles at one valid time;
- native three-hour ensemble time series from one fixed model cycle;
- pressure-layer diagnostic distributions using the same lapse-rate/shear/stability kernels as GFS;
- aligned deterministic GFS-vs-GEFS distribution comparison from one shared initialization cycle;
- explicit raw pressure-variable and pressure-surface selections;
- native three-hour cadence through `f384` in the current WFG contract;
- mean, population spread, extrema and caller-selected quantiles;
- optional scalar threshold member fractions explicitly marked as **not calibrated probabilities**;
- compact profile/time-series/diagnostic summaries by default, with full member values only on request;
- direct NOAA AWS `.idx` byte-range access and immutable local caching.

See [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) for the ensemble contract and [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) for aligned cross-model comparison semantics.

### Operation support today

| Operation | GFS 0.25° | GEFS 0.5° |
| --- | --- | --- |
| Pressure profile | ✅ deterministic | ✅ ensemble distribution |
| Point time series | ✅ multi-field | ✅ one-field distribution |
| Layer diagnostics | ✅ deterministic | ✅ per-member then summarized |
| Whole-profile diagnostics | ✅ | not yet |
| Parcel / CAPE / CIN | ✅ | not yet; current GEFS inventory lacks required parity |
| Multi-point | ✅ | not yet |
| Multi-point time series | ✅ | not yet |
| Transect | ✅ | not yet |
| Area statistics | ✅ | not yet |
| Run comparison | ✅ | not yet |
| Ensemble distribution | — | ✅ |
| GFS-vs-GEFS comparison | ✅/GEFS composition | ✅/GFS composition |

Both model families are available through local stdio MCP and remotely hostable Streamable HTTP MCP. CLI and MCP share core services and schemas.

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

The canonical CLI is operation-oriented. Where both models support an operation, select the model with `--model gfs|gefs`. GFS remains the default for backward compatibility.

Discover the deterministic GFS catalog before constructing detailed GFS selections:

```bash
wfg catalog
wfg catalog --search "cloud base" --sections fields --json
```

### Pressure profile — GFS

```bash
wfg profile \
  --model gfs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --fields temperature_2m,wind_10m,low_cloud_cover \
  --json
```

`--model gfs` may be omitted because it is the default.

### Pressure profile — GEFS

```bash
wfg profile \
  --model gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height \
  --levels 1000,925,850,700,500 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

GEFS returns a distribution summary for every requested variable/level cell. Add `--include-members` only when individual member profiles are required. `--members c00,p01,p02,...` selects a subset; otherwise all 31 members are used.

`wfg ensemble-profile` remains as an explicit compatibility alias and routes through the same unified profile service.

### Point time series — GFS

```bash
wfg timeseries \
  --model gfs \
  --lat 50.08 \
  --lon 14.43 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --json
```

### Point time series — GEFS

```bash
wfg timeseries \
  --model gefs \
  --lat 50.08 \
  --lon 14.43 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

The current GEFS time-series primitive accepts exactly one raw variable and one pressure surface. It resolves one model cycle for the complete range. Per-step member values are omitted by default. `wfg ensemble-timeseries` remains an explicit compatibility alias through the same dispatcher.

### Layer diagnostics — same meteorology, different result semantics

Deterministic GFS:

```bash
wfg layer \
  --model gfs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --lower 850 \
  --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --json
```

GEFS:

```bash
wfg layer \
  --model gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --lower 850 \
  --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --quantiles 0.1,0.5,0.9 \
  --json
```

For GEFS, WFG calculates the diagnostic independently for each member using that member's temperature, wind and geopotential heights. Member-specific layer depth is therefore also a distribution. Only after those physical calculations are complete are mean/spread/quantiles produced. `--include-members` exposes the audit path.

### GEFS scalar ensemble distribution

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

The optional threshold is reported as a raw member fraction, not a calibrated real-world probability.

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

`latest` resolves one shared initialization cycle that can satisfy both deterministic GFS and every requested GEFS member. The result reports deterministic-minus-ensemble-mean difference, standardized difference, empirical member rank fractions, and whether deterministic GFS falls outside the selected member range. It does not invent an `isOutlier` threshold.

### Explicit parcel diagnostics — currently GFS

```bash
wfg parcel \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

### Diagnostic time series — currently GFS

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

### Transect — currently GFS

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

### Area summary — currently GFS

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
| `latest` | Resolve the newest complete GFS cycle through `f384` |
| `profile` | Canonical GFS/GEFS pressure-profile operation selected by `--model` |
| `timeseries` | Canonical GFS/GEFS point time-series operation selected by `--model` |
| `layer` | Canonical GFS/GEFS pressure-layer diagnostic operation using shared physical kernels |
| `ensemble` | GEFS member values and distribution summary for one raw pressure-level field at one point/time |
| `ensemble-profile` | Explicit GEFS compatibility alias for ensemble pressure profiles |
| `ensemble-timeseries` | Explicit GEFS compatibility alias for ensemble time series |
| `compare-gfs-gefs` | Deterministic GFS positioned inside an aligned GEFS member distribution |
| `profile-diagnostics` | GFS freezing-level crossings and sampled inversion layers |
| `parcel` | GFS explicit surface/mixed-layer/most-unstable parcel LCL/LFC/EL/CAPE/CIN |
| `diagnostic-timeseries` | GFS native-cadence layer/profile/parcel diagnostics |
| `points` | Same GFS field selection for up to 50 points from one shared S3 slice |
| `transect` | 2–50 great-circle samples across explicit GFS pressure levels |
| `points-timeseries` | Multi-point native GFS series with shared slices per step |
| `compare-runs` | Same point/valid time across 2–6 consecutive GFS cycles |
| `area` | Bounded GFS raw-field min/max/mean plus optional distribution statistics |

Every query command supports JSON output.

## MCP

MCP keeps explicit model-named wrappers even where the core operation is shared. This avoids exposing agents to oversized polymorphic input/output schemas while preserving one implementation underneath.

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
- `get_gfs_profile`
- `get_gefs_ensemble_profile`
- `get_gfs_timeseries`
- `get_gefs_ensemble_timeseries`
- `get_gfs_layer_diagnostics`
- `get_gefs_layer_diagnostics`
- `get_gefs_ensemble`
- `compare_gfs_to_gefs`
- `get_gfs_profile_diagnostics`
- `get_gfs_parcel_diagnostics`
- `get_gfs_diagnostic_timeseries`
- `get_gfs_points`
- `get_gfs_transect`
- `get_gfs_points_timeseries`
- `compare_gfs_runs`
- `summarize_gfs_area`

## Model and diagnostic semantics

### Shared atmospheric core

The core has explicit model capability metadata and model-discriminated operation contracts. A shared operation returns a union rather than a flattened lowest-common-denominator structure. The `model` discriminator therefore always tells callers which result semantics apply.

Normalized pressure-profile snapshots are the shared physical boundary. Deterministic GFS profiles map directly to it. GEFS member profiles are adapted member-by-member into the same normalized `ProfileLevel` representation before diagnostics run.

The same principle applies to ensemble statistics: scalar fields, profile cells, and diagnostic outputs use one implementation for mean, population standard deviation and linearly interpolated quantiles.

### Deterministic GFS

WFG only accepts pressure levels actually published by the GFS 0.25° isobaric product. Unsupported arbitrary levels are rejected before a network request.

The GFS catalog includes raw pressure-level variables and deterministic local derivations such as wind, dew point, potential temperature, mixing ratio, virtual temperature, moist-air density, wet-bulb temperature, and equivalent potential temperature. It also declares pressure-layer diagnostics, whole-profile diagnostics, parcel definitions, and non-isobaric fields.

Non-isobaric fields preserve explicit vertical semantics (`surface`, height above ground, named layer, named level) and temporal semantics (`instantaneous`, `accumulation`, `average`). WFG fails rather than silently substituting a different level or time-window product.

### GEFS

GEFS has a separate explicit inventory because the 0.5° `pgrb2a` product is not identical to deterministic GFS 0.25°. The current ensemble surface supports temperature, relative humidity, U/V wind components and geopotential height on documented common pressure surfaces, with additional 300/400-hPa support for U/V wind where the complete requested operation can be satisfied.

Member order is canonicalized to `c00,p01,...,p30`. All members in a one-time result come from the same model initialization cycle and valid time. Ensemble profiles additionally require all selected fields within each member and all requested members to resolve to one GEFS grid point. Ensemble time series guarantee that every forecast step belongs to one fixed model cycle.

Profile selections are Cartesian: every selected raw variable must exist at every selected pressure level. Summary-only output is the default; memberwise values are opt-in.

### Shared layer meteorology

Pressure-layer diagnostics currently include environmental temperature lapse rate, vector wind shear, and potential-temperature gradient. The physical formulas exist once in model-independent code.

For GFS they are evaluated once on the deterministic profile. For GEFS they are evaluated separately for each requested member. This matters because both fields **and geopotential layer depth** vary by member. GEFS then summarizes the resulting diagnostic values and layer depths across the selected ensemble.

Whole-profile diagnostics and parcel calculations currently remain GFS-only orchestration. The capability catalog makes that explicit; future GEFS implementations should compose the same normalized profile/physics boundaries rather than copy formulas.

Meteorological formulas have golden-reference validation against published MetPy reference cases; see [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md).

## Spatial and temporal composition

GFS multi-point queries reuse one selected-message S3 slice across all requested coordinates. Multi-point time series repeat that reuse once per forecast step. Transects compose the same batch primitive over evenly spaced great-circle coordinates.

Diagnostic time series compose existing single-time diagnostic services. WFG resolves one query-aware run for the complete valid-time range, walks the native GFS forecast timeline, and evaluates one fixed diagnostic selection at each step.

Area queries use a bounded NOMADS geographic subset and compute statistics locally without returning the raw grid.

GEFS profiles compose raw pressure-level messages vertically: one member-specific selected-message slice contains the requested Cartesian variable/level cells and is decoded once, then distributions are aggregated across members. AWS range requests are sequential within each member while member processing remains bounded-concurrent.

GEFS layer diagnostics reuse that profile primitive, adapt each member to the normalized pressure-profile representation, run the common diagnostic kernel, and only then aggregate member results.

GEFS time series compose the one-time member-distribution service over native three-hour steps. Query-aware range resolution chooses one initialization that can satisfy the complete interval, and each underlying step receives that explicit run. Summary-only output is the default to avoid multiplying agent context by `members × forecast steps` unless the caller explicitly requests member trajectories.

The GFS-vs-GEFS comparison composes deterministic GFS and GEFS primitives after resolving one shared cycle. The comparison layer owns alignment and descriptive distribution metrics, not a second GRIB access implementation.

## Run selection

### GFS

GFS query tools support:

- `latest` — newest cycle whose already-published data can satisfy the specific query;
- `latest_complete` — newest cycle published through `f384`;
- explicit 00Z/06Z/12Z/18Z initialization timestamps.

Query-aware `latest` checks requested dependencies and valid time/range so WFG does not choose a newer run that has not published enough data yet.

### GEFS and aligned comparison

GEFS one-time profile, scalar ensemble, and layer-diagnostic operations support:

- `latest` — newest six-hour GEFS cycle for which every requested member exists at the required valid time;
- explicit 00Z/06Z/12Z/18Z initialization timestamps.

GEFS time series use the same explicit-run option. For `latest`, the resolver selects the newest cycle that starts no later than the first requested valid time and has selected members published at both ends of the complete range. That run is then fixed across every intermediate step.

`compare_gfs_to_gefs` / `wfg compare-gfs-gefs` use a stricter aligned `latest`: the chosen cycle must contain the selected deterministic GFS field and all requested GEFS members at the same valid time. Both model calls then receive that explicit shared run.

The current WFG GEFS contract requires native three-hour output and caps forecast hour at `f384`.

## NOAA data paths

**NOMADS Grib Filter** is the default for deterministic GFS single-point requests and the bounded-area path because it can subset geographically before transfer. Every physical NOMADS request passes through one file-backed cross-process limiter with an **11-second post-request cooldown**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. Cache hits do not consume the limiter.

**NOAA AWS Open Data** is used for deterministic GFS batch/transect/time-series/run-comparison work, aligned GFS-vs-GEFS comparison, and all GEFS member access. WFG reads `.idx` inventories, calculates byte ranges for selected GRIB messages, downloads only those ranges, caches immutable slices, and samples locally with `wgrib2`. GEFS profile/diagnostic selections are stitched into one cached multi-message slice per member and decoded once.

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

It exercises deterministic GFS AWS/NOMADS paths plus a deliberately small GEFS control-plus-two-member suite covering scalar distribution, two-variable/two-level profile, layer diagnostics, two-step ensemble time series, and aligned deterministic GFS-vs-GEFS comparison. GitHub Actions runs it on a low-frequency weekly schedule and supports manual dispatch. Normal PR/main CI remains offline.

## Documentation map

- [INSTALL.md](INSTALL.md) — installation, Docker/npm distribution, stdio/HTTP MCP, hosting and release behavior
- [ARCHITECTURE.md](ARCHITECTURE.md) — core boundaries, model adapters, data paths, caching and surface design
- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — GEFS model/member/profile/time-series/diagnostic distribution semantics
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — aligned deterministic GFS vs GEFS distribution semantics
- [CATALOG_SEARCH.md](CATALOG_SEARCH.md) — deterministic GFS atmospheric discovery/search semantics
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — native-cadence GFS layer/profile/parcel diagnostic composition
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
npm run dev -- profile --model gefs --help
npm run mcp
npm run mcp:http
```

The executable CLI is intentionally thin: `src/cli.ts` creates one Commander root and registers command groups from `src/cli/`. Business logic lives in the shared core rather than in CLI or MCP handlers.

## Non-goals

WFG returns model data, ensemble-member distributions, descriptive cross-model comparisons, and deterministic physical derivations. It does not provide activity-specific suitability scores, safety advice, hidden meteorological interpretation, or present raw ensemble/member-rank evidence as calibrated probabilities or uncertainty.
