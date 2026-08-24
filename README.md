# Weather for Grown Ups

Agent-native access to NOAA numerical weather models: one TypeScript core with equal CLI and MCP surfaces.

WFG exposes model data and explicit physical semantics rather than trying to interpret weather for a particular activity. It normalizes NOAA naming, validates vertical and temporal semantics, selects only requested GRIB messages, manages upstream access and caching, computes physical transforms locally, and returns structured values suitable for agents.

## Design rule

> **Unify operations and physics; preserve model semantics.**

GFS and GEFS share model-independent pressure-profile and diagnostic kernels. They do **not** share a lowest-common-denominator result type:

- deterministic GFS returns deterministic values;
- GEFS returns member distributions and structural ensemble summaries;
- nonlinear GEFS diagnostics are calculated **member by member before aggregation**;
- raw member fractions and spread are never presented as calibrated probability or uncertainty;
- unsupported model/operation combinations remain explicit.

CLI is operation-oriented (`--model gfs|gefs` where an operation is shared). MCP keeps explicit model-named wrappers for compact, clear agent schemas. Both call the same core services.

## Current model support

| Operation | GFS 0.25° | GEFS 0.5° |
| --- | --- | --- |
| Pressure profile | ✅ deterministic | ✅ member distribution |
| Multi-point | ✅ deterministic | ✅ distribution per point |
| Raw point time series | ✅ multi-field | ✅ one-field distribution |
| Layer diagnostics | ✅ | ✅ per member → summarized |
| Whole-profile diagnostics | ✅ | ✅ per member → structural summaries |
| Diagnostic time series | ✅ layer/profile/parcel | ✅ layer/profile |
| Parcel / CAPE / CIN | ✅ | — current GEFS contract lacks required surface inputs |
| Multi-point time series | ✅ | ✅ one-field distribution per point-step |
| Transect | ✅ | — |
| Area statistics | ✅ | — |
| Run-to-run comparison | ✅ deterministic field deltas | ✅ distribution shifts |
| Ensemble distribution | — | ✅ |
| Aligned GFS-vs-GEFS comparison | ✅ | ✅ |

### Deterministic GFS 0.25°

The deterministic surface includes:

- pressure-level and non-isobaric point profiles;
- searchable field/diagnostic catalog;
- per-level thermodynamic derivations;
- pressure-layer diagnostics;
- freezing-level and inversion diagnostics;
- explicit surface/mixed-layer/most-unstable parcel LCL/LFC/EL/CAPE/CIN;
- native-cadence diagnostic time series;
- multi-point queries and multi-point time series;
- run comparison;
- great-circle transects;
- bounded area statistics, percentiles, thresholds and extrema;
- NOAA NOMADS and NOAA AWS Open Data access paths.

### GEFS 0.5°

The ensemble surface currently includes:

- operational atmospheric `pgrb2a` 0.5° product;
- control `c00` plus perturbed members `p01`–`p30`;
- scalar pressure-field member distributions;
- multi-variable/multi-level ensemble pressure profiles;
- **member-first multi-point distributions** that fetch one selected field slice per member and reuse it across all requested coordinates;
- **member-first multi-point time series** that repeat that reuse pattern across native three-hour steps from one fixed cycle;
- native three-hour raw-field ensemble time series from one fixed cycle;
- member-first layer diagnostics using the same lapse-rate/shear/stability physics as GFS;
- member-first freezing-level and sampled inversion diagnostics using the same whole-profile kernel as GFS;
- native three-hour layer/profile **diagnostic time series** from one fixed cycle/member set;
- run-to-run comparison of ensemble distribution descriptors across consecutive initializations;
- aligned deterministic GFS-vs-GEFS comparison from one shared initialization cycle;
- direct NOAA AWS `.idx` byte-range access and immutable local caching.

See [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md), [GEFS_MULTI_POINT.md](GEFS_MULTI_POINT.md), [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md), [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md), [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md), [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md), and [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md).

## Install

### Docker — recommended

The image includes Node.js 24 and `wgrib2 3.8.0`:

```bash
docker build -t weather-for-grown-ups .
docker run --rm weather-for-grown-ups --help
```

Tagged releases are designed for GHCR:

```bash
docker run --rm ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 --help
```

### npm

```bash
npm install -g weather-for-grown-ups
wfg --help
```

The npm package provides `wfg`, `wfg-mcp`, and `wfg-mcp-http`. It intentionally does not install the native GRIB decoder; `wgrib2` must be on `PATH` or configured through `WGRIB2_PATH`.

See [INSTALL.md](INSTALL.md) for Docker, npm, stdio MCP, Streamable HTTP MCP, hosting, and release details.

## CLI examples

GFS remains the default model for backward compatibility.

### Pressure profile

Deterministic GFS:

```bash
wfg profile \
  --model gfs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --fields temperature_2m,wind_10m \
  --json
```

GEFS distribution profile:

```bash
wfg profile \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height \
  --levels 1000,925,850,700,500 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

GEFS profile output is summary-only by default. Add `--include-members` for memberwise audit values.

### Multi-point distributions

```bash
wfg points \
  --model gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 0 \
  --json
```

GEFS currently accepts one raw variable/pressure surface and up to 20 coordinates. WFG downloads the selected field once per member, samples every requested point from those cached slices, and returns one ensemble distribution per location. Add `--include-members` only when point-level member values are needed.

Deterministic GFS uses the same `points` CLI operation with its broader deterministic field selection and up to 50 points.

### Raw point time series

```bash
wfg timeseries \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

The current GEFS raw time-series primitive accepts one raw variable and one pressure surface. `ensemble-profile` and `ensemble-timeseries` remain compatibility aliases over the same unified dispatchers.

### Multi-point time series

```bash
wfg points-timeseries \
  --model gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

GEFS multi-point time series fixes one model cycle for the complete range. At each native three-hour step WFG fetches one selected field slice per member, samples all requested coordinates locally, and summarizes each location across members. `maxSteps` defaults to 80 and `maxSamples` defaults to 1,600 point-steps; both can be lowered or raised within schema limits. Add `--include-members` only when raw member values are required at every point-step.

### Layer diagnostics

```bash
wfg layer \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --lower 850 --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --quantiles 0.1,0.5,0.9 \
  --json
```

For GEFS, WFG calculates each diagnostic independently using each member's own fields and geopotential layer depth, then summarizes the resulting diagnostic values.

### Whole-profile diagnostics

```bash
wfg profile-diagnostics \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

GEFS structural summaries include raw member event fractions/count distributions and conditional height/pressure/layer-strength distributions only where a structure exists. WFG does not invent an “ensemble mean freezing level.”

### Diagnostic time series

GEFS profile-structure series:

```bash
wfg diagnostic-timeseries \
  --model gefs \
  --kind profile \
  --lat 50.08 --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

GEFS layer series uses `--kind layer --lower ... --upper ...`. The series fixes one run, member set, quantile set, sampling and diagnostic selection across all native three-hour steps. It intentionally returns compact ensemble summaries only; use the single-time diagnostic commands for member-level drill-down.

GFS supports `--kind layer`, `profile`, and `parcel`; GEFS currently supports `layer` and `profile` only.

### Run-to-run comparison

GEFS distribution evolution:

```bash
wfg compare-runs \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 5 \
  --cycles 3 \
  --json
```

Each GEFS cycle is summarized independently with the same member selection. WFG then reports newer-minus-older shifts in mean, population spread, extrema, quantiles and optional threshold fraction. It deliberately does **not** subtract `p01` in one initialization from `p01` in another; repeated perturbation labels are not treated as trajectories across model cycles.

Deterministic GFS uses the same `compare-runs` CLI operation but retains direct field-delta semantics.

### Scalar ensemble distribution

```bash
wfg ensemble \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

Threshold output is a raw member fraction, not a calibrated probability.

### Compare GFS with GEFS

```bash
wfg compare-gfs-gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The resolver selects one initialization cycle that can satisfy both models. WFG reports deterministic-minus-ensemble-mean, standardized difference, member ranks and range position without inventing an `isOutlier` threshold.

## MCP

### stdio

```bash
wfg-mcp
```

### Streamable HTTP

```bash
wfg-mcp-http
```

Safe default: `127.0.0.1:3000`, MCP endpoint `/mcp`, health check `/healthz`. See [INSTALL.md](INSTALL.md) before exposing it remotely.

Current MCP tools include:

- `get_gfs_catalog`
- `search_gfs_catalog`
- `get_latest_gfs_run`
- `get_gfs_profile`
- `get_gefs_ensemble_profile`
- `get_gfs_points`
- `get_gefs_points`
- `get_gfs_timeseries`
- `get_gefs_ensemble_timeseries`
- `get_gfs_points_timeseries`
- `get_gefs_points_timeseries`
- `get_gfs_layer_diagnostics`
- `get_gefs_layer_diagnostics`
- `get_gfs_profile_diagnostics`
- `get_gefs_profile_diagnostics`
- `get_gfs_diagnostic_timeseries`
- `get_gefs_diagnostic_timeseries`
- `get_gfs_parcel_diagnostics`
- `get_gefs_ensemble`
- `compare_gfs_to_gefs`
- `get_gfs_transect`
- `compare_gfs_runs`
- `compare_gefs_runs`
- `summarize_gfs_area`

MCP wrappers stay model-specific even where CLI operations are unified; this keeps agent input/output schemas smaller and less ambiguous.

## Ensemble diagnostic and composition semantics

### Multi-point reuse

GEFS multi-point queries are member-first. One selected raw-field GRIB slice is fetched/cached for each member, then every requested coordinate is sampled locally from those same slices. This makes upstream selected-field transfer scale with member count rather than `members × points`, while each location still gets its own model-native ensemble distribution.

Multi-point time series repeat that same member-first batch once per native forecast step from one fixed cycle. Selected-field upstream work therefore scales with `steps × members`, not `steps × members × points`.

For each requested coordinate all members must resolve to the same GEFS grid point. Multi-point time series additionally require that sampled grid point to remain stable across forecast steps. Member values are summary-only by default and opt-in for audit.

### Layer diagnostics

The physical formulas for temperature lapse rate, vector wind shear and potential-temperature gradient exist once. GFS evaluates them on one deterministic profile. GEFS evaluates them independently for every member and only then calculates mean, population spread and quantiles.

### Whole-profile structures

Freezing crossings and sampled inversion layers are also derived independently per member. Because these are variable-length structures, WFG summarizes comparable descriptors rather than averaging structures themselves.

Freezing summaries include:

- fraction of members with any crossing;
- crossing-count distribution;
- conditional lowest/highest crossing height and pressure distributions.

Inversion summaries include:

- fraction of members with any inversion;
- inversion-count distribution;
- total sampled inversion-depth distribution;
- conditional deepest/strongest inversion distributions.

Conditional distributions include the number of contributing members. If no member contains the structure, those fields are absent instead of populated with artificial zeros.

### Through time

GEFS raw-field and diagnostic time series preserve their one-time semantics at every native three-hour step. `run="latest"` resolves one cycle capable of satisfying the **complete range**, then each step receives that explicit run. Member fractions do not become calibrated probabilities merely because they are tracked through time.

### Across model cycles

GEFS run comparison preserves the same model-native approach across initializations. Every cycle is summarized independently, and only comparable distribution descriptors are differenced. Transition results are explicitly labeled `distribution_shift_between_model_cycles_not_member_trajectory` so agents do not infer memberwise continuity that the ensemble design does not provide.

## Run selection

### GFS

GFS query tools support:

- `latest` — newest cycle able to satisfy the exact query;
- `latest_complete` — newest cycle published through `f384`;
- explicit 00/06/12/18Z cycles.

### GEFS

GEFS one-time tools—including multi-point—support `latest` or an explicit 00/06/12/18Z cycle. Multi-point resolves `latest` exactly once for the complete coordinate set. Time-series tools—including multi-point time series—use range-aware `latest`: one cycle must cover both ends of the complete requested range for all selected members, and that run is fixed across intermediate steps.

GEFS run comparison uses `latest` as the newest anchor cycle whose selected members exist at the requested valid time, or accepts an explicit anchor. Older comparison cycles are then generated at six-hour intervals and requested explicitly so the comparison cannot drift while new output publishes.

The current WFG GEFS contract uses native three-hour output through `f384`.

## NOAA data paths

**NOMADS Grib Filter** is used where geographic subsetting is valuable, especially deterministic single-point/area work. Every physical NOMADS request passes through a cross-process file-backed limiter with an **11-second post-request cooldown**.

**NOAA AWS Open Data** is used for reusable deterministic slices and all GEFS member access. WFG reads `.idx` inventories, downloads selected GRIB byte ranges, caches immutable slices, and samples locally with `wgrib2`.

GEFS multi-field/profile/diagnostic queries stitch selected messages into one cached slice per member. GEFS multi-point queries use one cached selected-field slice per member and sample all coordinates locally from it. GEFS multi-point time series repeat that selected-field/member reuse at each native step from the same fixed cycle. Byte-range requests are sequential within a member; member and time-step work is bounded-concurrent.

Default cache/state: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

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

The live suite covers deterministic AWS/NOMADS paths and deliberately small GEFS samples spanning scalar distributions, **multi-point reuse**, pressure profiles, layer diagnostics, whole-profile diagnostics, two-step diagnostic time series, raw-field time series, consecutive-cycle distribution comparison, and aligned GFS-vs-GEFS comparison. GitHub Actions runs it weekly and supports manual dispatch; normal PR/main CI remains offline.

See [LIVE_SMOKE.md](LIVE_SMOKE.md).

## Documentation

- [INSTALL.md](INSTALL.md) — install, Docker/npm, stdio/HTTP MCP, hosting
- [ARCHITECTURE.md](ARCHITECTURE.md) — core boundaries, data paths, caching, surface design
- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — GEFS member/profile/raw-series contract
- [GEFS_MULTI_POINT.md](GEFS_MULTI_POINT.md) — member-first spatial sampling and per-point distribution semantics
- [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md) — bounded fixed-cycle spatial × temporal ensemble composition
- [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md) — freezing/inversion ensemble semantics
- [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md) — fixed-cycle diagnostic temporal composition
- [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md) — cycle-to-cycle ensemble distribution evolution
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — aligned deterministic-vs-ensemble comparison
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — deterministic diagnostic series
- [CATALOG_SEARCH.md](CATALOG_SEARCH.md) — GFS catalog search
- [TRANSECT.md](TRANSECT.md) — great-circle cross sections
- [AREA_SUMMARY.md](AREA_SUMMARY.md) / [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md) — bounded area statistics
- [RUN_COMPARISON.md](RUN_COMPARISON.md) — deterministic cycle comparison
- [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) — independent golden meteorology validation
- [TESTING.md](TESTING.md) — deterministic test architecture
- [LIVE_SMOKE.md](LIVE_SMOKE.md) — real NOAA integration suite

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run dev -- points --model gefs --help
npm run mcp
npm run mcp:http
```

Business logic lives in the shared core; CLI and MCP are adapters.

## Non-goals

WFG returns numerical-model data, ensemble distributions, descriptive cross-model comparisons, and explicit physical derivations. It does not provide activity-specific suitability scores, safety advice, hidden forecast interpretation, or present raw ensemble evidence as calibrated real-world probability or uncertainty.
