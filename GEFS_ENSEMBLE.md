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
- multi-point raw pressure-field distributions;
- native three-hour raw-field time series;
- member-first layer diagnostics;
- member-first whole-profile freezing/inversion diagnostics;
- native three-hour layer/profile diagnostic time series;
- run-to-run distribution comparison across consecutive model initializations;
- aligned deterministic GFS-vs-GEFS comparison.

The canonical shared CLI operations are:

```text
profile                --model gefs
points                 --model gefs
layer                  --model gefs
profile-diagnostics    --model gefs
timeseries             --model gefs
diagnostic-timeseries  --model gefs
compare-runs           --model gefs
```

`ensemble-profile` and `ensemble-timeseries` remain compatibility aliases over the same core dispatchers.

MCP keeps explicit model wrappers such as `get_gefs_ensemble_profile`, `get_gefs_points`, `get_gefs_layer_diagnostics`, `get_gefs_profile_diagnostics`, `get_gefs_diagnostic_timeseries`, and `compare_gefs_runs` because smaller model-specific schemas are clearer for agents.

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

All numeric GEFS distribution surfaces use the same implementation for arithmetic mean, population standard deviation, min/max, and caller-selected quantiles with linear interpolation over sorted values.

When a surface reports a member threshold/event fraction, it is labeled:

`raw_member_fraction_not_calibrated_probability`

For example, 20/31 members exceeding a threshold or containing a sampled inversion is useful model evidence, but WFG does not claim that value is a calibrated real-world probability.

## Pressure profiles

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

The default output is compact: one distribution summary per variable/level cell. `--include-members` adds every selected member's normalized profile values.

Within one member all decoded fields must resolve to one GEFS grid point, and all selected members must resolve to the same GEFS grid point. WFG fails rather than combining inconsistent samples.

## Multi-point distributions

```bash
wfg points \
  --model gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.04 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 5 \
  --json
```

The current GEFS multi-point primitive accepts one raw pressure-level variable and one pressure surface at 1–20 coordinates.

Execution is deliberately **member-first**:

1. resolve one run for the complete query;
2. fetch the selected GRIB field slice once per member;
3. sample every requested coordinate locally from that member slice;
4. verify that all members resolve consistently at each location;
5. summarize each location independently across members.

Upstream selected-field fetch count therefore scales with the number of selected members, not `points × members`. Member values are omitted by default; `--include-members` / `includeMembers=true` enables per-location member audit values.

See [GEFS_MULTI_POINT.md](GEFS_MULTI_POINT.md).

## Layer diagnostics

```bash
wfg layer \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --lower 850 --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --json
```

GEFS layer diagnostics are not calculated on an ensemble-mean profile. WFG expands the deterministic dependencies, fetches the minimal profile slice per member, evaluates the shared physical kernel independently for each member, and only then summarizes member results. Each member's geopotential layer depth is preserved and summarized separately.

## Whole-profile diagnostics

```bash
wfg profile-diagnostics \
  --model gefs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --json
```

Each member independently produces crossing/inversion structures through the same whole-profile kernel used by GFS. WFG summarizes comparable descriptors rather than inventing an ensemble-mean structure.

Freezing summaries include member event fraction/count, crossing-count distribution, and conditional lowest/highest crossing height and pressure distributions. Inversion summaries include member event fraction/count, layer-count distribution, total sampled inversion depth, and conditional deepest/strongest inversion distributions.

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

The current GEFS raw time-series primitive accepts exactly one raw variable and one pressure surface. Member trajectories are omitted by default; `--include-members` adds them within the same initialization cycle.

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

GEFS supports `layer` and `profile` diagnostic series. Each query fixes one run, member set, quantile set, pressure sampling, and diagnostic selection across all native three-hour steps. The series intentionally returns compact summaries only; the corresponding single-time diagnostic tools provide member-level drill-down.

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

A GEFS run comparison fixes one raw field, pressure surface, valid time, member set and quantile set across 2–6 consecutive six-hour initialization cycles. Every cycle is summarized independently; adjacent transitions report newer-minus-older changes in comparable distribution descriptors.

WFG deliberately does not calculate `p01(new) - p01(old)` or equivalent memberwise deltas across initialization cycles. Every transition carries:

`distribution_shift_between_model_cycles_not_member_trajectory`

See [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md).

## Run selection

One-time and multi-point GEFS operations accept `latest` or an explicit 00/06/12/18Z cycle. `latest` resolves once for the entire request, including all selected members.

For a time range, `latest` resolves one cycle that initializes no later than the requested start, covers the complete range inside the `f384` contract, and has all selected members published at both range ends. That run is then fixed across every intermediate step.

For run comparison, `latest` resolves the newest usable anchor cycle for the selected valid time/member set. Older cycles are generated at exact six-hour intervals and every underlying ensemble query receives its explicit run.

## Data access and caching

GEFS uses NOAA AWS Open Data directly. WFG identifies each immutable member object, caches `.idx` inventories, selects required messages, downloads only the corresponding byte ranges, caches the resulting GRIB slices, decodes locally with `wgrib2`, and performs aggregation/derivation locally.

Profile and diagnostic queries can stitch several messages into one cached slice per member. Multi-point queries instead select one field slice per member and reuse it across all requested coordinates. Point decoding stays sequential inside a member while member work is bounded-concurrent, avoiding unbounded `wgrib2` process fan-out.

AWS Open Data paths do not use the NOMADS scripted-access limiter.

## Aligned deterministic comparison

`compare_gfs_to_gefs` / `wfg compare-gfs-gefs` resolves one initialization cycle that can satisfy deterministic GFS and every selected GEFS member at the same valid time. The result preserves distinct GFS 0.25° and GEFS 0.5° sampled grid points and reports descriptive model-vs-member-distribution metrics rather than a binary outlier judgment.

See [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md).

## Explicit non-goals / unsupported surfaces

The current GEFS contract does not yet provide:

- parcel/CAPE/CIN diagnostics, because the required surface/non-isobaric parcel inputs have not been added to the GEFS source contract;
- GEFS multi-point time series;
- GEFS transects;
- GEFS area distributions;
- calibrated probabilities;
- activity-specific suitability or safety judgments.

Those should be added only when their model/source semantics are explicit, not by mechanically copying deterministic GFS endpoints.
