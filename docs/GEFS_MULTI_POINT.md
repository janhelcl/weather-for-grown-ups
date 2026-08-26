# GEFS multi-point distributions

WFG can summarize one raw GEFS pressure-level field across the selected ensemble at multiple locations in one query.

The execution rule is:

> **Fetch per member, sample many points locally, summarize per point.**

For richer selections that mix pressure variables and non-isobaric fields, use `ensemble-fields-points` / `get_gefs_fields_points`; see [GEFS_FIELD_BUNDLES.md](GEFS_FIELD_BUNDLES.md). This document describes the compact one-raw-field primitive.

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

MCP: `get_gefs_points`.

The CLI operation is shared with deterministic GFS, but the result remains model-specific: GFS returns deterministic values while GEFS returns an ensemble distribution at each requested location.

## Query contract

A GEFS raw multi-point request fixes:

- 1–20 coordinates;
- one initialization cycle;
- one native valid time;
- one raw `pgrb2a` pressure-level variable;
- one supported pressure surface;
- one selected member set;
- one quantile set;
- optional normalized-unit `>=` threshold.

`run="latest"` resolves once for the complete query. An explicit 00/06/12/18Z run is available for reproducibility.

The one-variable/one-level restriction is intentional for this compact primitive; mixed selections are already available through the field-bundle multi-point surface rather than being emulated with repeated calls.

## Member-first execution

For every selected member, WFG:

1. resolves the immutable GEFS `pgrb2a` object;
2. reads/caches its `.idx` inventory;
3. fetches/caches the selected field byte range exactly once;
4. samples every requested coordinate from that local member slice;
5. normalizes the field value.

Only after every member is sampled does WFG aggregate each location across members.

With 31 members and 20 requested points, selected-field upstream transfer remains 31 member slices rather than 620 independent source fetches. Local point extraction still scales with members × points and is bounded-concurrent.

Sampling uses WFG's decoder abstraction. The npm default decoder is bundled; native `wgrib2` is optional and does not change the member-first reuse model.

## Per-point result semantics

Every requested location returns its requested coordinate, actual sampled GEFS grid coordinate, member count, arithmetic mean, population standard deviation, extrema, selected quantiles and optional raw threshold count/fraction.

Complete member values are omitted by default. Use `--include-members` / `includeMembers=true` when member-level audit values are actually needed.

Threshold fractions retain the interpretation:

```text
raw_member_fraction_not_calibrated_probability
```

They describe ensemble membership, not calibrated real-world probability.

## Grid consistency

For each requested coordinate, all selected members must resolve to the same GEFS 0.5° grid point. WFG fails if members disagree rather than combining different sampled cells.

Different requested coordinates can of course resolve to different grid points; each result keeps the requested and sampled coordinates together.

## Multi-point time series

The temporal version is `points-timeseries --model gefs` / `get_gefs_points_timeseries`. It preserves the same raw-field restriction and member-first reuse across one fixed cycle.

See [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md).
