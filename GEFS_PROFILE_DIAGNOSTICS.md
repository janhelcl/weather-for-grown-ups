# GEFS whole-profile diagnostics

WFG applies whole-profile meteorology to GEFS **member by member** and only then summarizes comparable structural descriptors across the selected members.

This is deliberately different from computing a freezing level or inversion structure from an ensemble-mean temperature profile. The latter can create structures that no individual member contains, erase structures that members disagree about, and generally breaks the meaning of nonlinear diagnostics.

## Supported diagnostics

The current surface supports the same shared profile kernel as deterministic GFS:

- `freezing_level_crossings`
- `temperature_inversion_layers`

Both require temperature and geopotential height at every requested pressure surface. GEFS validation therefore rejects any pressure selection where the complete dependency set is not published by the 0.5° `pgrb2a` contract before network access.

The caller supplies the sampled pressure levels explicitly. Diagnostic resolution is exactly the resolution of those samples; WFG does not imply unresolved structure between unrequested levels.

## CLI

The canonical CLI operation is model-selectable:

```bash
wfg profile-diagnostics \
  --model gefs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --levels 1000,925,850,700,500,250 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

By default all 31 GEFS members are used. `--members c00,p01,p02,...` narrows the member set. `--include-members` adds every member's sampled profile and complete derived crossing/inversion structures; summary-only output is the default.

Without `--model gefs`, the command remains the backward-compatible deterministic GFS operation.

## MCP

Use:

- `get_gefs_profile_diagnostics`

The deterministic counterpart remains:

- `get_gfs_profile_diagnostics`

The tools are explicit in MCP for agent schema clarity even though both route to the same shared profile diagnostic kernel.

## Result semantics

### Freezing-level crossings

Each member independently produces zero or more sampled/interpolated 0 °C crossings. The ensemble result then reports:

- raw member count/fraction with at least one crossing;
- distribution of crossing count across **all** selected members;
- lowest crossing height/pressure distribution across only members that have a crossing;
- highest crossing height/pressure distribution across only members that have a crossing.

Lowest/highest crossing distributions are omitted when no selected member contains a crossing. WFG does not encode “no crossing” as an arbitrary height or pressure.

### Temperature inversions

Each member independently produces zero or more contiguous sampled inversion layers. The ensemble result reports:

- raw member count/fraction with at least one inversion layer;
- distribution of inversion-layer count across all selected members;
- distribution of total sampled inversion depth across all members, using zero when a member contains no inversion;
- conditional distribution of the deepest inversion-layer depth among members that contain at least one layer;
- conditional distribution of the strongest temperature increase among members that contain at least one layer;
- conditional distribution of the strongest mean inversion gradient among members that contain at least one layer.

Conditional distributions explicitly report `contributingMemberCount` so an agent can distinguish a tightly clustered quantity supported by many members from the same numeric spread based on only one or two members.

## Member fractions are not calibrated probabilities

Event fractions use the same explicit interpretation as other WFG ensemble surfaces:

`raw_member_fraction_not_calibrated_probability`

For example, 20 of 31 members containing a sampled inversion is reported as `20 / 31`. WFG does not claim this is a calibrated 64.5% real-world probability of an inversion.

## Data path

For one query WFG:

1. expands the selected diagnostics to raw temperature + geopotential-height dependencies;
2. validates every dependency at every requested pressure surface;
3. resolves one GEFS initialization cycle and selected member set;
4. fetches one cached multi-message GRIB slice per member;
5. decodes each member profile once;
6. adapts each member to the shared atmospheric profile shape;
7. runs the same deterministic profile diagnostic kernel independently for each member;
8. summarizes structural descriptors across members.

The source remains direct NOAA AWS Open Data. Member processing is bounded-concurrent while byte-range downloads inside one member remain sequential.

## Non-goals

This surface does not:

- derive structures from ensemble-mean fields;
- match individual inversion layers across members into a synthetic common layer;
- claim calibrated event probabilities;
- infer structure between pressure levels that were not sampled;
- provide activity-specific interpretation or safety advice.
