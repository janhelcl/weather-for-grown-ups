# GEFS ensemble access

WFG exposes NOAA Global Ensemble Forecast System (GEFS) data as a model-native ensemble primitive rather than converting member spread into a hidden confidence score.

GEFS is integrated into WFG's shared atmospheric core: operations and physical kernels are reused where scientifically valid, while member/distribution semantics remain explicit.

## Current contract

- product: operational atmospheric `pgrb2a` 0.5°;
- members: control `c00` plus `p01`–`p30`;
- cycles: 00/06/12/18Z;
- current WFG horizon: `f000`–`f384`;
- native cadence: 3 hours;
- source: NOAA AWS Open Data `.idx` + byte-range access;
- decoder: `wgrib2`;
- immutable local member-slice caching.

Current GEFS operations:

- scalar raw pressure-field distributions;
- multi-variable/multi-level pressure profiles;
- native three-hour raw-field time series;
- member-first layer diagnostics;
- member-first whole-profile freezing/inversion diagnostics;
- native three-hour layer/profile diagnostic time series;
- run-to-run distribution comparison across consecutive model initializations;
- aligned deterministic GFS-vs-GEFS comparison.

The canonical shared CLI operations are:

```text
profile                --model gefs
layer                  --model gefs
profile-diagnostics    --model gefs
timeseries             --model gefs
diagnostic-timeseries  --model gefs
compare-runs           --model gefs
```

`ensemble-profile` and `ensemble-timeseries` remain explicit compatibility aliases over the same core dispatchers.

MCP keeps explicit wrappers such as `get_gefs_ensemble_profile`, `get_gefs_layer_diagnostics`, `get_gefs_profile_diagnostics`, `get_gefs_diagnostic_timeseries`, and `compare_gefs_runs` because smaller model-specific schemas are clearer for agents.

## Supported pressure variables

WFG validates against the GEFS `pgrb2a` inventory rather than silently inheriting deterministic GFS's broader catalog.

Common supported pressure levels are `10,50,100,200,250,500,700,850,925,1000` hPa for:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

`u_wind` and `v_wind` additionally support `300` and `400` hPa in the current contract.

A raw profile is an explicit Cartesian selection: every requested variable must exist at every requested pressure surface. A diagnostic query must have every raw dependency available at every required pressure surface. Invalid combinations fail before network access.

## Ensemble statistics

All GEFS numeric distribution surfaces use the same implementation for:

- arithmetic mean;
- population standard deviation;
- min/max;
- caller-selected quantiles with linear interpolation over sorted values.

Thus spread/quantile semantics are identical whether the sampled quantity is a raw temperature, a profile cell, a member-specific layer depth, or a diagnostic output.

### Raw member fractions

When a surface reports a member fraction, it is labeled:

`raw_member_fraction_not_calibrated_probability`

For example, 20/31 members exceeding a threshold or containing a sampled inversion is useful model evidence, but WFG does not claim that value is a calibrated real-world probability.

## Pressure profiles

Example:

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

The default output is compact: one distribution summary per variable/level cell. `--include-members` adds every selected member's raw normalized profile values.

Within one member all decoded fields must resolve to one GEFS grid point, and all selected members must resolve to the same GEFS grid point. WFG fails rather than combining inconsistent samples.

## Layer diagnostics

Example:

```bash
wfg layer \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --lower 850 --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --json
```

GEFS layer diagnostics are **not** calculated on an ensemble-mean profile. WFG:

1. expands the same raw dependencies used by deterministic GFS;
2. fetches one minimal multi-message profile slice per member;
3. adapts each member into the shared normalized profile representation;
4. evaluates the same layer kernel independently for each member;
5. summarizes the member diagnostic values afterwards.

Each member has its own geopotential layer depth, so layer depth is returned as a distribution as well.

## Whole-profile diagnostics

Example:

```bash
wfg profile-diagnostics \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --json
```

Each member independently produces its own crossing/inversion structures through the same whole-profile kernel used by GFS. WFG then summarizes comparable descriptors rather than inventing an ensemble-mean structure.

Freezing summaries include:

- fraction/count of members with any crossing;
- crossing-count distribution;
- conditional lowest/highest crossing height and pressure distributions.

Inversion summaries include:

- fraction/count of members with any inversion;
- layer-count distribution;
- total sampled inversion-depth distribution;
- conditional deepest/strongest inversion distributions.

Conditional distributions state how many members contributed and disappear entirely when no member contains that structure.

See [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md).

## Raw-field time series

```bash
wfg timeseries \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The current GEFS raw time-series primitive accepts exactly one raw variable and one pressure surface. Member trajectories are omitted by default; `--include-members` adds them within the **same initialization cycle**.

## Diagnostic time series

```bash
wfg diagnostic-timeseries \
  --model gefs \
  --kind profile \
  --lat 50.08 --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --json
```

GEFS supports `layer` and `profile` diagnostic series. Each query fixes one run, member set, quantile set, pressure sampling, and diagnostic selection across all native three-hour steps.

The series intentionally returns compact ensemble summaries only. Full member diagnostic structures are a single-time drill-down path through `layer --model gefs` or `profile-diagnostics --model gefs` / the corresponding MCP tools.

See [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md).

## Run-to-run distribution comparison

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

A GEFS run comparison fixes one raw field, pressure surface, valid time, member set and quantile set across 2–6 consecutive six-hour initialization cycles. Every cycle is summarized independently through the normal ensemble service. Adjacent transitions then report newer-minus-older shifts in mean, population spread, extrema, quantiles, and optional threshold member fraction.

WFG deliberately does **not** calculate `p01(new) - p01(old)` or equivalent memberwise deltas across initialization cycles. Reused perturbation labels are not treated as continuous trajectories. Every transition therefore carries:

`distribution_shift_between_model_cycles_not_member_trajectory`

See [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md).

## Run selection

One-time GEFS operations accept `latest` or an explicit 00/06/12/18Z cycle.

For a time range, `latest` resolves one cycle that:

1. initializes no later than the first requested valid time;
2. can cover the complete requested range inside the current `f384` contract;
3. has all selected members published at both range ends.

That run is then passed explicitly to every intermediate step, preventing cycle drift during evaluation.

For run comparison, `latest` resolves the newest usable **anchor** cycle for the selected valid time/member set. Older cycles are generated at exact six-hour intervals and every underlying ensemble query receives its explicit run.

## Data access and caching

GEFS uses NOAA AWS Open Data directly.

For each selected member, WFG:

1. identifies the immutable `pgrb2a` object for run/forecast hour/member;
2. caches the `.idx` inventory;
3. selects only required GRIB messages;
4. downloads the relevant byte ranges;
5. stitches multi-field selections into one cached GRIB slice per member;
6. decodes locally with `wgrib2`;
7. performs physical derivation and aggregation locally.

Byte ranges are sequential inside one member while member work is bounded-concurrent. Diagnostic time series add bounded step concurrency around those existing member-aware single-time services. Run comparison adds bounded cycle concurrency around the existing scalar ensemble service.

AWS Open Data paths do not use the NOMADS scripted-access limiter.

## Aligned deterministic comparison

`compare_gfs_to_gefs` / `wfg compare-gfs-gefs` resolves one initialization cycle that can satisfy deterministic GFS and every selected GEFS member at the same valid time. The result preserves distinct GFS 0.25° and GEFS 0.5° sampled grid points and reports descriptive model-vs-member-distribution metrics rather than a binary outlier judgment.

See [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md).

## Explicit non-goals / unsupported surfaces

The current GEFS contract does **not** yet provide:

- parcel/CAPE/CIN diagnostics, because the required surface/non-isobaric parcel inputs have not been added to the GEFS source contract;
- multi-point GEFS queries;
- GEFS transects;
- GEFS area distributions;
- calibrated probabilities;
- activity-specific suitability or safety judgments.

Those should be added only when their model/source semantics are explicit, not by mechanically copying deterministic GFS endpoints.
