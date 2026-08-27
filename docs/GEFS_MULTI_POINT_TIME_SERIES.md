# GEFS multi-point time series

A GEFS point × time matrix is the normal query language with:

```text
dataset = gefs
geometry = points
time = range
```

No separate public point-time-series tool exists.

> **Fix one run, then for each forecast step fetch once per member, sample many points locally, and summarize per point.**

For `T` steps, `M` members and `P` points, selected-field upstream work scales with `T × M`, not `T × M × P`.

## CLI

```bash
wfg query \
  --dataset gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --max-point-steps 1600 \
  --json
```

MCP: `query_atmosphere` with points geometry and a time range.

## Fixed-run semantics

`run=latest` resolves once against the complete range/member selection. Every step then receives that explicit cycle, so publication of a newer run cannot cause mid-series drift.

## Bounds

The unified query validates forecast step count and point × step guardrails before upstream work. Member payloads can make responses much larger and should be requested only when needed.

## Per-step execution

For each native valid time:

1. one selected field slice is fetched/cached per member;
2. every requested coordinate is sampled locally;
3. each coordinate is summarized across members;
4. the next step repeats with the same fixed run.

The same shape also supports mixed pressure/non-isobaric selections; changing the selection does not create a new public operation.

Raw member fractions remain uncalibrated ensemble evidence.
