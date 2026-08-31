# NOAA HGEFS

HGEFS is WFG's hybrid NOAA ensemble: a single forecast population made from **31 GEFS physics members plus 31 AIGEFS AI members**.

It remains behind the same public atmospheric query language:

```text
dataset × geometry × time × selection
```

Use `dataset: "hgefs"`. There is no HGEFS-specific CLI command or MCP tool.

## Model semantics

| Property | WFG contract |
| --- | --- |
| Public dataset | `hgefs` |
| Internal dataset | `hgefs_0p25` |
| Provider | NOAA |
| Model class | `hybrid` |
| Result kind | ensemble |
| Members | 62 |
| Physics population | 31 GEFS members |
| AI population | 31 AIGEFS members |
| Canonical member IDs | `gefs:c00..p30`, `aigefs:c00..p30` |
| Initialization cycles | 00/06/12/18 UTC |
| Native forecast output | every 6 hours |
| Forecast horizon | f000 through f240 |
| Run selectors | `latest`, explicit ISO cycle |

The population prefix is part of the member identity. `gefs:p07` and `aigefs:p07` are not interchangeable labels and WFG never pairs them as trajectories.

## Why HGEFS is a composition layer

NOAA's operational HGEFS product is the grand ensemble formed from the GEFS and AIGEFS populations. The dedicated HGEFS files publish hybrid ensemble statistics; the individual member states remain in the constituent GEFS and AIGEFS feeds.

WFG therefore does **not** create a duplicate HGEFS member downloader. It composes the existing first-class constituent implementations:

```text
GEFS member state ─────┐
                      ├─ member-first normalized state / diagnostic
AIGEFS member state ──┘
                                ↓
                      62-member hybrid distribution
```

That keeps source access, caching and model-specific decoding where they already belong while making hybrid composition an application/core concern.

## Native grids stay visible

The two constituents do not always use the same native grid for the same request. In particular, GEFS pressure-level member data can use its 0.5° pressure product while AIGEFS is 0.25°.

HGEFS therefore does not invent one synthetic `gridPoint` for the hybrid result. Point-like results expose `constituentGridPoints`, and raw member payloads retain population identity. Area results keep member spatial statistics on their native constituent grids before pooling comparable statistics.

This is intentional: a unified atmospheric question does not imply fake numerical symmetry.

## Member-first meteorology

All nonlinear meteorology stays member first.

For every selected GEFS or AIGEFS member WFG first obtains/derives the requested atmospheric state, computes diagnostics inside that member, and only then summarizes the hybrid population.

Numeric distributions report mean, population standard deviation, extrema and requested quantiles. Wind direction uses circular aggregation. Member fractions remain raw ensemble evidence, not calibrated probability.

## Capability intersection

HGEFS exposes only selections that both constituent populations can satisfy with equivalent meteorological meaning.

The current shared surface includes:

- point profiles and mixed field selections;
- native 6-hour time ranges;
- multi-point queries and ranges;
- great-circle transects;
- bounded area statistics;
- layer and profile diagnostics;
- diagnostic time ranges.

Pressure-level availability is the intersection of the AIGEFS inventory and the GEFS member inventory. For example, WFG rejects a pressure/variable pair that exists in AIGEFS but is unavailable in GEFS rather than silently dropping one population.

Parcel diagnostics remain unsupported because the AI constituent lacks the full parcel-initialization surface state required by WFG's shared parcel kernel.

## Example

```json
{
  "dataset": "hgefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-31T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  },
  "ensemble": {
    "members": ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

Omitting `ensemble.members` selects the full 62-member population.
