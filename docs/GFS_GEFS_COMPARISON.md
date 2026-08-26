# Deterministic GFS vs GEFS comparison

WFG can place one deterministic GFS 0.25° pressure-level value inside the distribution of selected GEFS 0.5° members from the **same initialization cycle and valid time**.

The purpose is to expose evidence for questions such as “is deterministic GFS unusually warm relative to the ensemble?” without inventing a hidden confidence score or an arbitrary binary outlier threshold.

## Contract

A comparison query selects:

- one latitude/longitude;
- one shared initialization cycle, or `latest`;
- one valid time on the GEFS three-hour cadence;
- one raw pressure-level variable supported by both model surfaces;
- one published GEFS pressure level for that variable;
- two or more GEFS members;
- optional GEFS quantiles.

Supported variables are the same raw GEFS pressure variables:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

## Aligned run selection

`run="latest"` is **cross-model query-aware**. WFG walks common 00Z/06Z/12Z/18Z cycles backward and accepts a cycle only when:

1. deterministic GFS publishes the selected field/pressure surface at the required forecast hour; and
2. every requested GEFS member exists at that same forecast hour.

The GFS value and GEFS member values therefore come from one shared initialization timestamp. WFG does not independently select a newer GFS cycle and an older GEFS cycle and compare them as though they were aligned.

An explicit shared cycle is available for reproducibility.

## Different model grids are preserved

Deterministic GFS is sampled from its 0.25° grid and GEFS from its 0.5° grid. One requested coordinate may therefore resolve to different model grid points.

The result preserves both sampled grid coordinates separately. WFG does not pretend the grids are identical or silently resample one model onto the other for this point comparison.

## Returned comparison metrics

The result contains the deterministic GFS value, requested GEFS member values, the GEFS distribution summary, and:

- `deterministicMinusEnsembleMean`;
- `standardizedDifference` = `(GFS - GEFS mean) / GEFS population standard deviation`;
- member counts/fractions below and at-or-below deterministic GFS;
- `rangePosition` — `below_member_min`, `within_member_range`, or `above_member_max`;
- `outsideMemberRange`.

If the selected members have zero spread, `standardizedDifference` is `null` rather than infinite or fabricated.

## Why there is no `isOutlier` boolean

An “outlier” threshold is a decision rule, not a raw model fact. A caller may care about the full member range, a chosen standardized difference, selected quantiles, or domain-specific materiality in physical units.

WFG returns the evidence and leaves that rule explicit in the consuming layer.

The interpretation marker is:

`raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty`

Neither empirical member rank nor standardized difference is presented as a calibrated probability that the deterministic forecast is wrong.

## CLI

```bash
wfg compare-gfs-gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

All 31 GEFS members are used by default; `--members` can select a smaller explicit subset.

## MCP

The equivalent MCP tool is `compare_gfs_to_gefs`.

CLI and MCP use the same aligned-run/core comparison semantics.

## Data paths

Both sides use NOAA AWS Open Data:

- deterministic GFS: selected `.idx` byte ranges from the 0.25° product;
- GEFS: member-specific selected `.idx` byte ranges from the 0.5° `pgrb2a` product.

Immutable slices are cached through the model-specific caches and sampled locally through WFG's decoder abstraction. The npm default decoder is bundled; native `wgrib2` remains an optional compatibility/debug backend.
