# Deterministic GFS vs GEFS comparison

WFG can place one deterministic GFS 0.25° pressure-level value inside the distribution of selected GEFS 0.5° members from the **same initialization cycle and valid time**.

The public operation is `compare-datasets` / `compare_datasets`.

## Contract

The current dataset pair is `["gfs","gefs"]`. A comparison selects one point, shared run (or `latest`), valid time, raw pressure variable/level, GEFS member set and optional quantiles.

`latest` is cross-dataset query-aware: a cycle is accepted only when both GFS and all requested GEFS members can satisfy the same valid time and selection.

## Different grids are preserved

GFS is sampled from 0.25° and GEFS from 0.5°. The result preserves both sampled grid points separately rather than pretending the model grids are identical.

## Returned evidence

The result includes the deterministic value, GEFS distribution and metrics such as deterministic-minus-ensemble-mean, standardized difference, empirical member rank information, range position and whether deterministic GFS lies outside the selected member range.

If ensemble spread is zero, standardized difference is null rather than infinite.

WFG deliberately does not return an `isOutlier` boolean: an outlier threshold is a consuming-layer decision rule, not a raw model fact.

## CLI

```bash
wfg compare-datasets \
  --dataset gfs \
  --against gefs \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `compare_datasets`.

The interpretation remains raw deterministic-model versus raw ensemble-distribution evidence, not calibrated forecast uncertainty.
