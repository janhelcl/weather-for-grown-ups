# GEFS multi-point distributions

WFG can summarize the same raw GEFS pressure-level field across the selected ensemble at multiple requested locations in one query.

The execution rule is:

> **Fetch per member, sample many points locally, summarize per point.**

This matters because a naïve implementation would perform upstream work proportional to `members × points`. WFG instead downloads the selected GRIB field slice once for each member and reuses that immutable local slice for every requested coordinate.

## Public surfaces

CLI:

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

MCP:

- `get_gefs_points`

The CLI shares the `points` operation with deterministic GFS. The result contract remains model-specific: GFS returns deterministic values; GEFS returns an ensemble distribution for each requested location.

## Query contract

A GEFS multi-point request fixes:

- 1–20 coordinates;
- one initialization cycle;
- one native valid time;
- one raw `pgrb2a` pressure-level variable;
- one published pressure surface;
- one selected member set;
- one quantile set;
- optional normalized-unit `>=` threshold.

`run="latest"` is resolved once for the complete point set. The selected cycle must contain all requested members at the requested forecast hour. An explicit 00/06/12/18Z run is supported for reproducibility.

The current multi-point surface intentionally accepts one raw variable and one pressure surface. This keeps upstream reuse and response semantics straightforward. Broader selections can be added later through the same member-first execution model rather than multiplying point calls.

## Member-first execution

For every selected member, WFG:

1. resolves one immutable GEFS `pgrb2a` object;
2. reads/caches the `.idx` inventory;
3. downloads/caches the byte range for the selected field exactly once;
4. samples every requested coordinate from that local GRIB slice with `wgrib2`;
5. normalizes the field value.

Only after all members have been sampled does WFG aggregate each location across members.

If there are 31 members and 20 requested points, the selected-field source fetch count is still 31 member slices rather than 620 separate source fetches. Point decoding is sequential within a member while members remain bounded-concurrent, which also bounds simultaneous `wgrib2` processes.

Cache state is returned per member slice. This makes reuse observable without exposing internal HTTP details.

## Per-point result semantics

Every requested location returns:

- original requested coordinate;
- actual sampled GEFS grid coordinate;
- member count;
- arithmetic mean;
- population standard deviation;
- minimum and maximum;
- selected quantiles;
- optional raw threshold count/fraction.

By default the complete member values are omitted. Set `includeMembers=true` / `--include-members` when member-level audit data is needed.

Threshold fractions retain the standard WFG interpretation:

```text
raw_member_fraction_not_calibrated_probability
```

They are descriptive ensemble membership, not calibrated real-world probabilities.

## Grid consistency

For each requested coordinate, all selected members must resolve to the same GEFS 0.5° grid point. WFG fails if members disagree rather than combining values from inconsistent grid cells.

Different requested coordinates can of course resolve to different grid points. The result keeps each requested coordinate paired with its own sampled grid coordinate.

## Relationship to deterministic GFS points

Both model families support the conceptual `points` operation:

- GFS uses one shared selected-message slice and returns deterministic field values for up to 50 points;
- GEFS uses one selected field slice **per member**, samples all coordinates from those slices, then returns an ensemble distribution per point for up to 20 points.

This is another example of WFG's architecture rule: unify operations, preserve model semantics.

## Multi-point time series

The temporal composition is implemented as `points-timeseries --model gefs` and MCP tool `get_gefs_points_timeseries`:

```text
one fixed GEFS run
  -> one forecast step
     -> one selected field slice per member
     -> sample all requested points
     -> summarize per point
  -> repeat across native three-hour steps
```

The matrix is explicitly bounded by `maxSteps` and `maxSamples`, and `run="latest"` is resolved once for the complete range before member data is accessed.

See [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md) for the full temporal contract and execution semantics.
