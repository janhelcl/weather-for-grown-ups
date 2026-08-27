# GEFS whole-profile diagnostics

WFG applies whole-profile meteorology to GEFS **member by member** and only then summarizes comparable structural descriptors.

The public operation is `diagnose` / `diagnose_atmosphere` with `dataset=gefs` and `diagnostic.kind="profile"`.

## Supported diagnostics

- `freezing_level_crossings`
- `temperature_inversion_layers`

Both require temperature and geopotential height at every requested pressure surface. The caller supplies sampling levels explicitly; WFG does not imply unresolved structure between them.

## CLI

```bash
wfg diagnose \
  --dataset gefs \
  --kind profile \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --levels 1000,925,850,700,500,250 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `diagnose_atmosphere`.

Use the same operation with `dataset=gfs` for deterministic GFS or `dataset=gfs-analysis` for historical analysis.

## Result semantics

Freezing crossings are found independently in every member, then summarized through event/count and conditional lowest/highest crossing distributions.

Temperature inversions are likewise found independently per member, then summarized through event/count, total depth, deepest-layer depth, strongest warming and strongest mean-gradient distributions.

Conditional distributions report contributing-member count so sparse structures remain explicit.

## Member fractions are not calibrated probabilities

Event fractions are raw ensemble membership. WFG does not promote them to calibrated real-world probability.

## Data path

WFG expands dependencies, validates pressure availability, resolves one cycle/member set, fetches one cached multi-message slice per member, adapts each member to the shared atmospheric profile, runs the deterministic diagnostic kernel independently, and summarizes the resulting structures.
