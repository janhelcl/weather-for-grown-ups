# GEFS ensemble access

WFG exposes NOAA Global Ensemble Forecast System (GEFS) data as a model-native uncertainty primitive rather than converting member spread into a hidden confidence score.

## Scope

The current GEFS surface covers:

- model: operational GEFS atmospheric `pgrb2a` 0.5° product;
- members: control `c00` plus perturbed `p01` through `p30`;
- one geographic point per query;
- scalar distribution queries for one raw variable/pressure surface;
- vertical profile queries over an explicit Cartesian selection of raw variables and pressure surfaces;
- one valid time **or a native three-hour valid-time range** for scalar time series;
- native three-hour forecast cadence from `f000` through `f384` in the current WFG contract;
- NOAA AWS Open Data `.idx` byte-range access only;
- normalized member values plus deterministic ensemble distribution summaries.

The profile surface composes multiple raw pressure cells at one point/time using one cached selected-message slice per member. The time-series surface composes the scalar point/member primitive across one fixed model cycle. Deterministic GFS-vs-GEFS comparison is a separate cross-model composition over the scalar member-distribution primitive; see [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md).

## Supported pressure-level variables

WFG validates against the GEFS `pgrb2a` inventory before network access instead of reusing the broader deterministic GFS 0.25° catalog.

Common supported pressure levels are `10,50,100,200,250,500,700,850,925,1000` hPa for:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

`u_wind` and `v_wind` additionally support `300` and `400` hPa in the current contract.

For an ensemble profile, every requested variable must exist at every requested pressure surface. Unsupported Cartesian variable/level combinations fail validation before network access rather than being silently substituted.

## CLI

### One variable at one valid time

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

By default all 31 members are sampled. A subset can be requested explicitly:

```bash
wfg ensemble \
  --lat 50.08 \
  --lon 14.43 \
  --run 2026-08-24T00:00:00Z \
  --valid 2026-08-24T12:00:00Z \
  --var geopotential_height \
  --level 500 \
  --members c00,p01,p02,p03,p04 \
  --json
```

### Ensemble pressure profile

```bash
wfg ensemble-profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height \
  --levels 1000,925,850,700,500 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The default profile result contains one distribution summary for every requested variable/level cell. It deliberately omits the full memberwise profile to keep agent context compact. Add `--include-members` only when the individual member vertical trajectories are required.

Profile queries are Cartesian: if `temperature,geopotential_height` and `850,500` are requested, the result covers `temperature@850`, `geopotential_height@850`, `temperature@500`, and `geopotential_height@500`.

### Native three-hour time series

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

The time-series command returns compact distribution summaries by default. Add `--include-members` only when individual member trajectories are required:

```bash
wfg ensemble-timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-24T18:00:00Z \
  --var geopotential_height \
  --level 500 \
  --members c00,p01,p02,p03,p04 \
  --include-members \
  --json
```

`--max-steps` bounds accepted output size. The hard contract maximum is 129 steps, corresponding to the current `f000` through `f384` three-hour horizon.

## MCP

The GEFS-only MCP tools are:

- `get_gefs_ensemble` for one variable/pressure surface at one valid time;
- `get_gefs_ensemble_profile` for multiple raw variables and pressure surfaces at one valid time;
- `get_gefs_ensemble_timeseries` for one variable/pressure surface across a native-cadence range.

The cross-model `compare_gfs_to_gefs` tool composes the scalar GEFS result with deterministic GFS from one aligned initialization cycle. CLI equivalents are `wfg ensemble`, `wfg ensemble-profile`, `wfg ensemble-timeseries`, and `wfg compare-gfs-gefs` respectively.

CLI and MCP call the same core services and validate against the same public schemas.

## Point result semantics

A one-time scalar ensemble result preserves:

- explicit GEFS model identity (`gefs_0p50`);
- initialization time, valid time, and forecast hour;
- requested coordinate and actual sampled model grid point;
- selected raw variable, GRIB code, pressure surface, normalized output field, and unit;
- every requested member's normalized value and cache-hit state;
- arithmetic mean;
- population standard deviation across the requested members;
- minimum and maximum;
- caller-selected quantiles using deterministic linear interpolation between sorted member values;
- optional count and fraction of requested members greater than or equal to a threshold.

## Profile semantics

An ensemble profile fixes one initialization cycle, valid time, coordinate, member selection, variable selection, and pressure-level selection.

For every variable/level cell, the compact result returns:

- normalized output field and unit;
- member count;
- arithmetic mean;
- population standard deviation;
- minimum and maximum;
- caller-selected quantiles.

Pressure levels are returned in descending pressure order. Member order is canonicalized to `c00,p01,...,p30`.

`includeMembers=false` is the default. With `includeMembers=true`, the result additionally includes every requested member's normalized value for every selected variable/level cell plus the member-slice cache state.

All decoded fields inside one member profile must resolve to one GEFS grid point, and all requested members must resolve to that same GEFS grid point. WFG fails rather than combining inconsistent samples.

## Time-series semantics

A GEFS ensemble time series resolves **one initialization cycle for the complete range** and uses that explicit run at every step. This prevents cycle drift when a newer GEFS run becomes partially available while a long query is being evaluated.

Every step always contains:

- native valid time and forecast hour;
- member count;
- mean and population standard deviation;
- min/max;
- requested quantiles;
- optional threshold count/fraction.

Individual member values are omitted by default to keep agent responses compact. `includeMembers=true` / `--include-members` includes the full member array at every step.

The result echoes the fixed member selection, quantiles, threshold, requested point, sampled grid point, and source provenance once at the series level rather than repeating those invariants at every step.

## Threshold fractions are not calibrated probabilities

If 20 of 31 requested members exceed a scalar threshold, WFG reports `20 / 31`. It explicitly labels that value `raw_member_fraction_not_calibrated_probability`.

This is useful evidence about ensemble behavior, but WFG does not claim that a 20/31 member fraction means a calibrated 64.5% real-world probability. Calibration, model weighting, climatological correction, and decision-specific interpretation belong in higher layers.

The same rule applies independently at every time-series step.

Profile summaries currently expose distributions and quantiles rather than threshold fractions; diagnostic probabilities should remain explicit higher-level compositions.

## Run selection

### One time and profiles

`run="latest"` starts from the newest six-hour GEFS cycle that could precede the requested valid time and walks backward until all requested member files exist at the required native forecast hour. The raw variable/level schema is validated before this source access.

### Time range

For a range, `run="latest"` starts from the newest cycle that could precede the **first** requested valid time. A candidate is accepted only when all requested members are available at both the start and end forecast hours. The selected initialization is then passed explicitly to every intermediate step.

This preserves three invariants:

1. the model run never begins after the first requested valid time;
2. the complete range fits inside the `f000`–`f384` contract;
3. every returned step belongs to one model initialization.

An explicit `00Z`, `06Z`, `12Z`, or `18Z` initialization timestamp is supported for reproducibility on all GEFS surfaces.

The current ensemble contract deliberately stops at `f384`, even where upstream GEFS products may offer longer horizons. Extending the horizon should be an explicit model-contract change with tests rather than an accidental side effect of upstream availability.

## Data access and caching

GEFS uses NOAA AWS Open Data directly.

For a scalar point query WFG:

1. resolves the member-specific immutable `pgrb2a` object;
2. fetches and caches its `.idx` inventory;
3. selects the byte range for the requested GRIB variable and pressure surface;
4. caches the immutable selected-message subset;
5. samples the requested point locally with `wgrib2`;
6. aggregates normalized values across members locally.

For an ensemble profile, WFG selects all requested variable/level messages from the same member object, downloads the selected ranges, stitches them into **one cached multi-message slice per member**, and decodes that slice once. Range requests are sequential inside each member while members are sampled with bounded concurrency. This prevents maximum upstream concurrency from multiplying by the number of profile cells.

Equivalent profile selections are canonicalized for cache identity, so reordering the same variables or pressure levels reuses the same immutable member slice.

A time series repeats the scalar primitive at each native forecast step. It uses bounded step concurrency while each step retains the existing bounded member concurrency.

The cache lives under `~/.cache/wfg/gefs-s3` by default, or beneath `WFG_CACHE_DIR` when configured. Repeated queries naturally reuse immutable member/forecast-hour slices.

Unlike NOMADS access, these paths do not use the 11-second NOMADS courtesy limiter because they read public AWS Open Data objects and byte ranges rather than scripted NOMADS filter requests.

## Deliberate non-goals of the current ensemble surface

Not yet included:

- ensemble parcel/layer/profile **diagnostics** derived member-by-member;
- ensemble profile time series;
- spatial ensemble areas or transects;
- calibrated probabilities;
- ensemble-derived activity suitability or safety judgments.

Aligned deterministic GFS-vs-GEFS comparison is available as a separate composition; see [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md). Future ensemble diagnostics should compose from the profile/member/source contract rather than bypass it.
