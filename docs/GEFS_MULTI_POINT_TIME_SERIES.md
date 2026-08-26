# GEFS multi-point time series

WFG can track one raw GEFS pressure-level field across multiple requested locations and native three-hour forecast steps while preserving the member-first data-access pattern used by one-time GEFS multi-point queries.

The execution rule is:

> **Fix one run, then for each forecast step fetch once per member, sample many points locally, and summarize per point.**

For `T` forecast steps, `M` selected members and `P` requested points, selected-field upstream work scales with `T × M`, not `T × M × P`.

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

MCP:

- `get_gefs_points_timeseries`

The CLI operation is shared with deterministic GFS. MCP keeps model-specific tools so agent schemas remain compact and explicit.

## Query contract

A request fixes:

- 1–20 coordinates;
- one initialization cycle for the complete range;
- inclusive start/end times on the native three-hour GEFS cadence;
- one raw `pgrb2a` pressure-level variable;
- one supported pressure surface;
- one selected member set;
- one quantile set;
- optional normalized-unit `>=` threshold;
- optional raw member values.

`run="latest"` is resolved once with the complete start/end range and selected member set. Every intermediate step then receives that explicit cycle, so publication of a newer GEFS run cannot cause the matrix to drift between model initializations.

Explicit 00/06/12/18Z cycles remain available for reproducibility.

## Bounded matrix

Two independent limits control response and execution size:

- `maxSteps` — defaults to 80 and cannot exceed the 129 native GEFS steps through `f384`;
- `maxSamples` — defaults to 1,600 point-steps and has a hard ceiling of 5,000.

The service computes `points × steps` before resolving `latest` or accessing member data. Oversized matrices therefore fail before upstream work starts.

These limits count point-time samples, not ensemble-member values. `includeMembers=true` can still make responses substantially larger and should be reserved for audit/member-trajectory use cases.

## Per-step execution

For each native valid time WFG delegates to the existing GEFS multi-point primitive:

1. one selected field slice is fetched/cached for each requested member;
2. all requested coordinates are decoded locally from that member slice;
3. each coordinate is aggregated across members;
4. the next forecast step repeats the same operation using the same fixed model run.

Forecast steps are bounded-concurrent. Within a member, point decoding remains sequential, preserving the existing cap on simultaneous `wgrib2` processes.

## Result semantics

Each forecast step returns:

- valid time and forecast hour;
- one result per requested coordinate in input order;
- requested and actual GEFS grid coordinates;
- member count, mean, population standard deviation, extrema and requested quantiles;
- optional raw `>=` threshold member count/fraction;
- optional raw member values;
- whether all member slices for that step came from cache.

The root result also reports whether all slices across all forecast steps were cache hits.

Threshold fractions retain the standard interpretation:

```text
raw_member_fraction_not_calibrated_probability
```

They are descriptive member fractions, not calibrated probabilities.

## Grid and run consistency

WFG fails rather than silently combining inconsistent data if:

- a batched step changes the fixed model run, valid time or forecast hour;
- the field selection changes;
- point count or point ordering changes;
- a requested coordinate resolves to a different GEFS grid point across forecast steps;
- the source is not the expected NOAA AWS `pgrb2a` byte-range path.

This makes the returned point-time matrix safe to compare through time without hidden run or grid-cell drift.

## Relationship to the one-point time series

`get_gefs_ensemble_timeseries` / `timeseries --model gefs` remains the compact one-location primitive. Multi-point time series is its spatial composition over the member-first multi-point path, not a loop over independent one-point queries.

Use the one-point tool for one location. Use the multi-point tool when the same field/range/member selection must be compared across several locations.
