# GEFS multi-point distributions

Multi-point GEFS access is expressed through the normal atmospheric query language:

> **dataset=gefs + geometry=points + one valid time + selection**

There is no separate public multi-point GEFS tool.

The execution rule remains:

> **Fetch per member, sample many points locally, summarize per point.**

## CLI

```bash
wfg query \
  --dataset gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `query_atmosphere` with `geometry.type="points"`.

The same public shape supports richer mixed pressure/non-isobaric selections.

## Member-first execution

For every selected member WFG resolves the immutable GEFS object, reads/caches its inventory, fetches the selected field slice once, samples every requested coordinate locally, and normalizes the values. Only then does WFG summarize each location across members.

With 31 members and 20 points, upstream selected-field transfer therefore remains 31 member slices rather than 620 independent source fetches.

## Result semantics

Each point preserves requested and sampled coordinates plus ensemble count, mean, population spread, extrema, selected quantiles and optional member payloads where the selected query shape supports them.

Member fractions are raw ensemble evidence, not calibrated real-world probability.

## Grid consistency

For each requested coordinate, all selected members must resolve to the same GEFS 0.5° grid cell. WFG fails rather than combining inconsistent sampled cells.

For multi-point time series, use the same `query` / `query_atmosphere` operation with a time range.
