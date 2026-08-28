# GEFS vs ECMWF IFS ENS comparison

WFG can compare GEFS and ECMWF IFS ENS through the existing `compare-datasets` / `compare_datasets` operation.

This is a **distribution-to-distribution** comparison. Each ensemble is evaluated independently at one point, one pressure level, one valid time and one shared initialization cycle. WFG does **not** pair GEFS `p01` with IFS ENS `p01`, or infer any trajectory/correspondence between member labels from different forecasting systems.

## Contract

Use the dataset pair:

```json
{
  "datasets": ["gefs", "ifs-ens"],
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "variable": "temperature",
  "pressureLevelHpa": 850,
  "run": "latest",
  "quantiles": [0.1, 0.5, 0.9]
}
```

`latest` walks backward through common 00/06/12/18 UTC initialization cycles until both requested member subsets can satisfy the same valid time and pressure selection. The valid time must be native to both products; in practice the stricter ECMWF ENS cadence governs long-range alignment.

By default WFG uses all 31 GEFS members (`c00` plus `p01`–`p30`) and all 50 IFS ENS perturbations (`p01`–`p50`). Optional `gefsMembers` and `ifsEnsMembers` select independent subsets.

ECMWF's unperturbed control is not part of `ifs-ens`: under Cycle 50r1 it is identical to deterministic `ifs`. GEFS retains its distinct `c00` control.

## Comparable pressure variables

The comparison accepts canonical scalar pressure variables supported by both ensemble pipelines, including raw state variables and shared derived thermodynamics.

Derived quantities are computed **inside each member before aggregation**. This is important: WFG never derives a nonlinear quantity from an ensemble mean.

The two centers do not necessarily publish identical raw dependencies. For example, where one product lacks a directly published canonical dependency WFG may derive the same normalized variable from the member state available from that product. The comparison therefore represents normalized model-state distributions, with each model's source/provenance retained.

## Returned comparison

For each ensemble WFG returns its own sampled grid point, member count and numeric distribution:

- mean;
- population standard deviation;
- min/max;
- requested quantiles.

The comparison then reports:

- `ifsEnsMinusGefsMean`;
- `ifsEnsMinusGefsPopulationStdDev`;
- the IFS-ENS/GEFS spread ratio (null when the selected GEFS members have zero spread);
- IFS-ENS-minus-GEFS shifts for every requested quantile.

These are differences between two raw ensemble systems, not forecast error and not calibrated uncertainty.

## Threshold fractions

An optional `thresholdGte` asks both ensembles the same threshold question in the normalized output unit.

WFG computes the fraction independently inside each ensemble and returns the difference between those raw fractions. Raw member fractions are **not calibrated probabilities**; unequal ensemble sizes also mean member counts should not be compared as if they were identically sampled populations.

No raw member payload is exposed by the comparison result.

## CLI

```bash
wfg compare-datasets \
  --against ifs-ens \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Optional member subsets and a common threshold:

```bash
wfg compare-datasets \
  --against ifs-ens \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --var temperature --level 850 \
  --gefs-members c00,p01,p02,p03 \
  --ifs-ens-members p01,p02,p03,p04 \
  --gte 0 \
  --json
```
