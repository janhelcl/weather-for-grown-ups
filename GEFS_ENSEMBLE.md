# GEFS ensemble access

WFG exposes NOAA Global Ensemble Forecast System (GEFS) data as a model-native ensemble primitive rather than converting member spread into a hidden confidence score.

GEFS is integrated into WFG's shared atmospheric core: operations and physical kernels are reused where scientifically valid, while member/distribution semantics remain explicit.

## Scope

The current GEFS surface covers:

- operational atmospheric `pgrb2a` 0.5° product;
- control `c00` plus perturbed `p01` through `p30`;
- scalar distributions for one raw variable/pressure surface;
- vertical profiles over explicit Cartesian raw-variable / pressure-surface selections;
- pressure-layer diagnostic distributions calculated member-by-member;
- one-field native three-hour time series from one fixed cycle;
- aligned deterministic GFS-vs-GEFS comparisons;
- native three-hour forecast cadence from `f000` through `f384` in the current WFG contract;
- NOAA AWS Open Data `.idx` byte-range access only;
- compact distribution summaries with memberwise data opt-in where response size could become large.

The canonical CLI operations shared with GFS are:

```text
profile    --model gefs
layer      --model gefs
timeseries --model gefs
```

`ensemble-profile` and `ensemble-timeseries` remain explicit GEFS compatibility aliases routed through the same core dispatchers.

MCP deliberately keeps explicit model-named wrappers such as `get_gefs_ensemble_profile` and `get_gefs_layer_diagnostics`, while the underlying meteorological/core primitives are shared.

## Supported pressure-level variables

WFG validates against the GEFS `pgrb2a` inventory before network access instead of reusing the broader deterministic GFS 0.25° inventory.

Common supported pressure levels are `10,50,100,200,250,500,700,850,925,1000` hPa for:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

`u_wind` and `v_wind` additionally support `300` and `400` hPa in the current contract.

For a profile, every requested variable must exist at every requested pressure surface. For a diagnostic, every dependency required by that diagnostic must exist at every required pressure surface. Unsupported combinations fail validation before network access rather than being silently substituted.

For example, U/V wind exists at 300/400 hPa, but a 400→300-hPa `wind_shear` query also needs geopotential height at both surfaces. If that complete dependency set is unavailable in the current WFG GEFS inventory, the diagnostic query is rejected before a download.

## CLI

### Scalar distribution at one valid time

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

By default all 31 members are sampled. A subset can be requested with `--members c00,p01,p02,...`.

### Ensemble pressure profile — canonical operation

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

The default result contains one distribution summary for every requested variable/level cell. It deliberately omits the full memberwise profile to keep agent context compact. Add `--include-members` only when individual member vertical states are required.

Profile queries are Cartesian: if `temperature,geopotential_height` and `850,500` are requested, the result covers all four variable/level cells.

`wfg ensemble-profile` is an explicit GEFS alias over the same underlying profile service.

### Layer diagnostics — shared physics

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

This is **not** a diagnostic calculated on the ensemble-mean profile. WFG instead:

1. expands the same diagnostic dependencies used by GFS;
2. fetches the needed GEFS profile cells for every selected member;
3. adapts each member into the shared normalized pressure-level representation;
4. runs the exact same layer diagnostic kernel independently for each member;
5. summarizes those member diagnostic results across the ensemble.

This distinction matters for nonlinear quantities and for height normalization. The physical depth between 850 and 500 hPa varies between members because member geopotential heights vary. GEFS therefore returns a **layer-depth distribution** alongside diagnostic-output distributions.

`includeMembers=true` / `--include-members` adds each member's endpoint heights/depth and diagnostic values for auditability.

Current shared layer diagnostics are:

- `temperature_lapse_rate`;
- `wind_shear`;
- `potential_temperature_gradient`.

### Native three-hour time series — canonical operation

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

The current GEFS time-series operation accepts exactly one raw variable and one pressure surface. Distribution summaries are compact by default. Add `--include-members` only when member trajectories are required.

`wfg ensemble-timeseries` remains an explicit GEFS alias over the same time-series dispatcher.

`--max-steps` bounds accepted output size. The hard GEFS contract maximum is 129 steps, corresponding to `f000` through `f384` at three-hour cadence.

## MCP

Current GEFS-related MCP tools are:

- `get_gefs_ensemble` — one raw variable/pressure surface at one valid time;
- `get_gefs_ensemble_profile` — multiple raw variables and pressure surfaces at one valid time;
- `get_gefs_layer_diagnostics` — shared layer physics evaluated per member and summarized;
- `get_gefs_ensemble_timeseries` — one raw variable/pressure surface across a native-cadence range;
- `compare_gfs_to_gefs` — deterministic GFS positioned inside an aligned GEFS member distribution.

MCP wrappers stay explicit even though profile/time-series/layer operations share internal dispatch/physics with GFS. This keeps tool schemas simple for agents.

## Distribution semantics

All GEFS distribution-producing surfaces use one shared implementation for:

- arithmetic mean;
- population standard deviation;
- minimum and maximum;
- caller-selected quantiles using linear interpolation over sorted members.

This means a p50 or population spread has identical mathematical semantics for raw temperature, a profile cell, layer depth, or a member-derived wind-shear value.

### Threshold fractions are not calibrated probabilities

If 20 of 31 requested members exceed a scalar threshold, WFG reports `20 / 31` and labels it `raw_member_fraction_not_calibrated_probability`.

WFG does not claim that this means a calibrated 64.5% real-world probability. Calibration, model weighting, climatological correction and decision-specific interpretation belong in higher layers.

## Profile semantics

An ensemble profile fixes one initialization cycle, valid time, coordinate, member selection, variable selection and pressure-level selection.

For every variable/level cell, the compact result returns:

- normalized output field and unit;
- member count;
- arithmetic mean;
- population standard deviation;
- min/max;
- caller-selected quantiles.

Pressure levels are returned in descending pressure order. Member order is canonicalized to `c00,p01,...,p30`.

With `includeMembers=true`, the result additionally includes every requested member's normalized value for every selected variable/level cell plus member-slice cache state.

All decoded fields inside one member profile must resolve to one GEFS grid point, and all requested members must resolve to that same GEFS grid point. WFG fails rather than combining inconsistent samples.

## Layer diagnostic semantics

A GEFS layer diagnostic has fixed pressure bounds but does **not** have one fixed physical height/depth across the ensemble.

For each member, WFG retains:

- lower/upper pressure surfaces;
- lower/upper member geopotential heights;
- member layer depth;
- diagnostic output values.

The compact public result returns:

- a distribution for member layer depth;
- one distribution for every declared output field of every selected diagnostic;
- selected member list and quantiles;
- model/run/valid-time/grid/source provenance.

This preserves the distinction between the pressure-coordinate request and the member-specific geometric realization of that layer.

## Time-series semantics

A GEFS ensemble time series resolves **one initialization cycle for the complete range** and passes that explicit run to every step. This prevents cycle drift while a newer GEFS run is partially publishing.

Every step contains:

- native valid time and forecast hour;
- member count;
- mean and population standard deviation;
- min/max;
- requested quantiles;
- optional threshold count/fraction.

Individual member values are omitted by default. `includeMembers=true` adds the member array at every step.

## Run selection

### One-time profile/scalar/layer operations

`run="latest"` starts from the newest six-hour GEFS cycle that could precede the requested valid time and walks backward until all selected member files exist at the required native forecast hour. Variable/pressure/diagnostic dependency validation happens before source access.

### Time range

For a range, `run="latest"` starts from the newest cycle that could precede the **first** requested valid time. A candidate is accepted only when all selected members are available at both start and end forecast hours. That cycle is then fixed across every intermediate step.

This preserves:

1. the model run never initializes after the first requested valid time;
2. the complete range fits inside the `f000`–`f384` contract;
3. every returned step belongs to one model initialization.

Explicit `00Z`, `06Z`, `12Z`, or `18Z` initialization timestamps are supported for reproducibility.

## Data access and caching

GEFS uses NOAA AWS Open Data directly.

For a scalar point query WFG:

1. resolves the member-specific immutable `pgrb2a` object;
2. fetches and caches its `.idx` inventory;
3. selects the requested GRIB variable/pressure byte range;
4. caches the immutable selected-message subset;
5. samples locally with `wgrib2`;
6. aggregates normalized member values locally.

For profile and layer-diagnostic work, WFG selects all required variable/level messages from the same member object, downloads the selected ranges, stitches them into **one cached multi-message slice per member**, and decodes that slice once. Range requests are bounded inside each member while members are processed with bounded concurrency.

Equivalent profile selections are canonicalized for cache identity, so reordering the same variables or pressure levels reuses the same immutable member slice.

A time series repeats the scalar primitive at each native forecast step with bounded step/member concurrency.

The cache lives under `~/.cache/wfg/gefs-s3` by default, or beneath `WFG_CACHE_DIR` when configured.

These paths do not use the 11-second NOMADS courtesy limiter because they read public AWS Open Data objects/ranges rather than the scripted NOMADS filter service.

## Relationship to deterministic GFS

GEFS is neither a copy of the GFS API nor an unrelated parallel stack.

Shared today:

- operation vocabulary for profile/time series/layer diagnostics;
- normalized pressure-profile representation;
- layer meteorological kernels;
- ensemble distribution mathematics where aggregation is needed;
- decoder abstraction and broad provenance conventions.

Still model-specific:

- upstream inventory and supported pressure surfaces;
- source/object paths;
- run/member availability semantics;
- deterministic versus ensemble result contracts;
- GFS-only non-isobaric/parcel/spatial capabilities not yet supported by GEFS.

## Deliberate non-goals of the current GEFS surface

Not yet included:

- ensemble whole-profile diagnostic distributions such as freezing-level/inversion ensemble structure;
- ensemble parcel/LCL/LFC/EL/CAPE/CIN diagnostics;
- ensemble diagnostic time series;
- ensemble profile time series;
- spatial ensemble areas or transects;
- calibrated probabilities;
- ensemble-derived activity suitability or safety judgments.

Future ensemble diagnostics should continue the existing pattern: obtain member atmospheric states through model adapters, run shared physical kernels per member, and aggregate only afterward.
