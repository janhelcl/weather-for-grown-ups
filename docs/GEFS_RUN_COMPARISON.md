# GEFS run comparison

WFG can compare the same raw GEFS pressure-level distribution across consecutive six-hour initialization cycles.

The governing rule is:

> **Compare distributions across cycles; do not treat perturbation member labels as trajectories.**

A member named `p01` in one GEFS initialization is not interpreted as a continuous forecast path that should be subtracted from `p01` in another initialization. Each cycle is summarized independently using the same selected member set, then WFG compares those distribution descriptors.

## Public surfaces

CLI:

```bash
wfg compare-runs \
  --model gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --members c00,p01,p02 \
  --quantiles 0.1,0.5,0.9 \
  --gte 5 \
  --cycles 3 \
  --json
```

MCP:

- `compare_gefs_runs`

The CLI operation name is shared with deterministic GFS. The result contract remains model-specific.

## Query contract

A comparison fixes:

- one requested point;
- one valid time;
- one raw GEFS `pgrb2a` pressure-level variable;
- one published pressure surface;
- one member set;
- one quantile set;
- optional normalized-unit `>=` threshold;
- 2–6 consecutive six-hour model cycles.

`anchorRun="latest"` resolves the newest GEFS cycle whose selected members exist at the requested valid time. An explicit 00Z/06Z/12Z/18Z cycle can be supplied for reproducibility. Older comparison cycles are generated at six-hour intervals from that anchor.

Every underlying cycle is then requested explicitly from `GefsEnsembleService`, so run selection cannot drift during the comparison.

## Result contract

Runs are ordered oldest → newest. Each run returns:

- initialization time;
- forecast hour for the common valid time;
- member count;
- arithmetic mean;
- population standard deviation;
- minimum and maximum;
- selected quantiles;
- optional raw threshold count/fraction;
- aggregate cache state.

Every adjacent transition returns newer-minus-older changes for:

- mean;
- population standard deviation;
- minimum;
- maximum;
- every selected quantile;
- optional threshold member fraction.

Each transition is labeled:

```text
distribution_shift_between_model_cycles_not_member_trajectory
```

This is descriptive model evolution, not calibrated forecast uncertainty.

## Why no memberwise cycle deltas?

GEFS perturbation members describe an ensemble around each initialization. Reusing the labels `p01`–`p30` does not make equal labels across separate initializations a scientifically meaningful trajectory pair.

For this reason WFG deliberately does **not** expose:

```text
p01(new run) - p01(old run)
p02(new run) - p02(old run)
...
```

An agent can instead ask whether the distribution shifted warmer/colder, widened/narrowed, moved a threshold fraction, or changed its tails/median.

## Grid and selection invariants

WFG requires every compared cycle to preserve:

- requested point;
- sampled GEFS grid point;
- variable;
- pressure surface;
- normalized output field and unit.

If the grid point or atmospheric selection changes across cycles, the query fails rather than combining incomparable snapshots.

## Relationship to deterministic GFS run comparison

Both models now support the conceptual `run_comparison` operation, but the semantics differ intentionally:

- deterministic GFS returns direct field deltas, including shortest-angle wind-direction deltas where applicable;
- GEFS returns **distribution descriptor shifts** and never member-ID deltas across cycles.

This follows WFG's architecture rule: unify operations, preserve model semantics.
