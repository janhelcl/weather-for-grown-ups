# GEFS ensemble access

WFG exposes NOAA Global Ensemble Forecast System (GEFS) data as a model-native uncertainty primitive rather than converting member spread into a hidden confidence score.

## Scope

The current GEFS surface covers:

- model: operational GEFS atmospheric `pgrb2a` 0.5° product;
- members: control `c00` plus perturbed `p01` through `p30`;
- one geographic point per query;
- one raw pressure-level variable and one pressure surface per query;
- one valid time **or a native three-hour valid-time range**;
- native three-hour forecast cadence from `f000` through `f384` in the current WFG contract;
- NOAA AWS Open Data `.idx` byte-range access only;
- normalized member values plus deterministic ensemble distribution summaries.

The time-series surface composes the same point/member primitive across one fixed model cycle; it does not introduce a parallel meteorology or source path.

## Supported pressure-level variables

WFG validates against the GEFS `pgrb2a` inventory before network access instead of reusing the broader deterministic GFS 0.25° catalog.

Common supported pressure levels are `10,50,100,200,250,500,700,850,925,1000` hPa for:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

`u_wind` and `v_wind` additionally support `300` and `400` hPa in the current contract.

Unsupported variable/level combinations fail validation rather than being silently substituted.

## CLI

### One valid time

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

The equivalent MCP tools are:

- `get_gefs_ensemble` for one valid time;
- `get_gefs_ensemble_timeseries` for a native-cadence range.

CLI and MCP call the same core services and validate against the same public schemas.

## Point result semantics

A one-time ensemble result preserves:

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

If 20 of 31 requested members exceed a threshold, WFG reports `20 / 31`. It explicitly labels that value `raw_member_fraction_not_calibrated_probability`.

This is useful evidence about ensemble behavior, but WFG does not claim that a 20/31 member fraction means a calibrated 64.5% real-world probability. Calibration, model weighting, climatological correction, and decision-specific interpretation belong in higher layers.

The same rule applies independently at every time-series step.

## Run selection

### One time

`run="latest"` starts from the newest six-hour GEFS cycle that could precede the requested valid time and walks backward until all requested member files exist at the required native forecast hour.

### Time range

For a range, `run="latest"` starts from the newest cycle that could precede the **first** requested valid time. A candidate is accepted only when all requested members are available at both the start and end forecast hours. The selected initialization is then passed explicitly to every intermediate step.

This preserves three invariants:

1. the model run never begins after the first requested valid time;
2. the complete range fits inside the `f000`–`f384` contract;
3. every returned step belongs to one model initialization.

An explicit `00Z`, `06Z`, `12Z`, or `18Z` initialization timestamp is supported for reproducibility on both surfaces.

The current ensemble contract deliberately stops at `f384`, even where upstream GEFS products may offer longer horizons. Extending the horizon should be an explicit model-contract change with tests rather than an accidental side effect of upstream availability.

## Data access and caching

GEFS uses NOAA AWS Open Data directly:

1. resolve the member-specific immutable `pgrb2a` object;
2. fetch and cache its `.idx` inventory;
3. select only the byte range for the requested GRIB variable and pressure surface;
4. cache the immutable selected-message subset;
5. sample the requested point locally with `wgrib2`;
6. aggregate normalized values across members locally.

A time series repeats this primitive at each native forecast step. It uses bounded step concurrency while each step retains the existing bounded member concurrency.

The cache lives under `~/.cache/wfg/gefs-s3` by default, or beneath `WFG_CACHE_DIR` when configured. Repeated series naturally reuse immutable member/forecast-hour slices.

Unlike NOMADS access, this path does not use the 11-second NOMADS courtesy limiter because it reads public AWS Open Data objects and byte ranges rather than scripted NOMADS filter requests.

## Deliberate non-goals of the current ensemble surface

Not yet included:

- ensemble profiles containing many variables/levels at once;
- ensemble parcel/layer/profile diagnostics;
- spatial ensemble areas or transects;
- calibrated probabilities;
- comparison of deterministic GFS against the GEFS distribution;
- ensemble-derived activity suitability or safety judgments.

Those should compose from the same model/member/source contract rather than bypass it.
