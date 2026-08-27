# GEFS run comparison

Run-to-run evolution is exposed through the canonical `compare-runs` / `compare_runs` operation with `dataset=gefs`.

The governing rule is:

> **Compare distributions across cycles; do not treat perturbation member labels as trajectories.**

A member named `p01` in one initialization is not paired physically with `p01` in another. Each cycle is summarized independently, then distribution descriptors are compared.

## CLI

```bash
wfg compare-runs \
  --dataset gefs \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-24T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --members c00,p01,p02 \
  --quantiles 0.1,0.5,0.9 \
  --gte 5 \
  --cycles 3 \
  --json
```

MCP: `compare_runs`.

## Contract

The comparison fixes one point, valid time, raw GEFS pressure variable/level, member set, quantiles, optional threshold and 2–6 consecutive six-hour cycles.

`anchorRun=latest` resolves the newest cycle satisfying the selection. Older cycles are generated at six-hour intervals and requested explicitly.

## Result semantics

Runs are ordered oldest to newest. Adjacent transitions report newer-minus-older shifts in mean, population spread, extrema, selected quantiles and optional threshold fraction.

Each transition is explicitly a distribution shift between model cycles, not a member trajectory.

## Relationship to GFS

The same public operation with `dataset=gfs` returns deterministic field deltas. The operation vocabulary is unified; the statistical meaning is not flattened.
