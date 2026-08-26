# GEFS multi-point time series

WFG can track one raw GEFS pressure-level field across multiple locations and native three-hour forecast steps while preserving the member-first reuse pattern of a one-time multi-point query.

> **Fix one run, then for each forecast step fetch once per member, sample many points locally, and summarize per point.**

For `T` steps, `M` selected members and `P` requested points, selected-field upstream work scales with `T × M`, not `T × M × P`.

For mixed pressure/non-isobaric selections through the same point × time shape, use `ensemble-fields-points-timeseries` / `get_gefs_fields_points_timeseries`; see [GEFS_FIELD_BUNDLES.md](GEFS_FIELD_BUNDLES.md).

## Public surfaces

CLI:

```bash
wfg points-timeseries \
  --model gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

MCP: `get_gefs_points_timeseries`.

## Query contract

The raw-field time-series request fixes:

- 1–20 coordinates;
- one initialization cycle for the complete range;
- inclusive start/end times on native three-hour GEFS cadence;
- one raw `pgrb2a` pressure variable;
- one supported pressure surface;
- one member set;
- one quantile set;
- optional normalized-unit `>=` threshold;
- optional member values.

`run="latest"` resolves once against the complete range/member selection. Every step receives that explicit cycle, so publication of a newer run cannot cause mid-series drift.

## Bounded matrix

Two limits bound the compact raw point × time operation:

- `maxSteps` defaults to 80 and cannot exceed the 129 native GEFS steps through `f384`;
- `maxSamples` defaults to 1,600 point-steps with a hard ceiling of 5,000.

WFG calculates the point × step size before run resolution or upstream access. `includeMembers=true` can still make responses much larger and should be used mainly for audit needs.

## Per-step execution

For each native valid time:

1. one selected field slice is fetched/cached per member;
2. every requested coordinate is sampled locally from that slice;
3. each coordinate is summarized across members;
4. the next step repeats with the same fixed model run.

Forecast steps and member work are bounded-concurrent. Local extraction goes through the decoder abstraction; the default npm decoder is bundled and native `wgrib2` is optional.

## Result semantics

Each step returns valid time/forecast hour, input-ordered point results, requested and sampled GEFS grid coordinates, member count, mean, population spread, extrema, quantiles, optional raw threshold fractions, optional member values and cache state.

Threshold fractions remain:

```text
raw_member_fraction_not_calibrated_probability
```

The time dimension does not turn raw member fractions into calibrated probability.

## Consistency invariants

WFG fails rather than silently combining inconsistent data if the fixed run, valid time/forecast hour, raw field selection, point ordering or sampled grid coordinates drift across the composed series.

## Relationship to other GEFS surfaces

- `timeseries --model gefs` / `get_gefs_ensemble_timeseries` — one location, one raw field;
- `points-timeseries --model gefs` / `get_gefs_points_timeseries` — several locations, one raw field;
- `ensemble-fields-points-timeseries` / `get_gefs_fields_points_timeseries` — several locations, mixed pressure/non-isobaric fields.

The distinctions are response/query shapes, not different ensemble semantics.
