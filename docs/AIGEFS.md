# NOAA AIGEFS

AIGEFS is NOAA's operational **AI ensemble forecast** and the ensemble counterpart to AIGFS. WFG exposes it through the normal atmospheric vocabulary as:

```text
dataset: "aigefs"
```

There is no AIGEFS-specific public API. The same query and diagnostic schemas used by the other atmospheric datasets apply, subject to the real AIGEFS inventory and ensemble semantics.

## Operational identity

WFG models the current operational product as:

- internal dataset: `aigefs_0p25`;
- provider: NOAA;
- model class: AI;
- result kind: ensemble;
- horizontal grid: 0.25°;
- cycles: 00/06/12/18 UTC;
- native output cadence: 6 hours;
- forecast horizon: f000 through f384;
- members: `000` through `030` (31 members).

The public catalog is the source of truth for supported fields and operations.

## Source layout and access

Operational member files are read from NOAA NOMADS using the native per-member layout:

```text
aigefs.YYYYMMdd/CC/memMMM/model/atmos/grib2/
  aigefs.tCCz.pres.fHHH.grib2
  aigefs.tCCz.sfc.fHHH.grib2
```

The corresponding `.idx` inventories are used to select only the pressure levels and surface messages needed by a request. WFG then downloads covering HTTP byte ranges and decodes them locally.

AIGEFS also publishes ensemble-statistics products under `ensstat/products/atmos/grib2`, including `avg` and `spr`. WFG may use the published ensemble average as a **run-completeness sentinel**, but it does **not** use upstream mean/spread files as a substitute for raw members when computing atmospheric state or diagnostics.

AIGFS and AIGEFS share the same file-backed NOMADS courtesy policy. Cache misses are serialized and retain the conservative 11-second post-request cooldown. Immutable indexes and selected GRIB slices are cached, so repeated queries do not repeatedly hit NOMADS.

## Inventory

AIGEFS follows the operational AIGFS atmospheric inventory currently exposed by WFG.

Pressure-level native variables:

- temperature;
- U and V wind components;
- geopotential height;
- specific humidity;
- pressure-coordinate vertical velocity.

Supported pressure surfaces are:

```text
50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000 hPa
```

Canonical derived variables whose dependencies exist—such as wind, potential temperature, mixing ratio, virtual temperature, air density, wet-bulb temperature and equivalent potential temperature—are evaluated independently inside each member.

The currently exposed single-level fields are:

- 2 m temperature;
- 10 m U and V wind plus derived `wind_10m`;
- mean-sea-level pressure;
- total precipitation.

As with deterministic AIGFS, total precipitation is not available at f000.

## Member-first semantics

AIGEFS follows WFG's ensemble rule:

> **derive inside each member, aggregate afterward.**

This matters for both ordinary derived variables and nonlinear meteorology. For example, a freezing level is computed independently from every member profile before the resulting crossing distributions are summarized. WFG never computes a freezing level from an ensemble-mean profile and presents that as ensemble physics.

Numeric values expose member distributions with mean, population standard deviation, extrema and requested quantiles. Circular wind direction uses circular statistics rather than a linear average.

Raw member fractions and spread are model evidence, not calibrated probabilities.

## Geometry and time

AIGEFS supports the same normal geometry/time vocabulary as the deterministic AIGFS path:

- point at one valid time;
- point time range;
- multiple points at one time;
- multiple-point time range;
- great-circle transect at one time;
- bounded scalar area summary.

Range sampling stays on the native 6-hour output cadence.

For bounded areas the aggregation order is deliberately:

```text
spatial statistic inside each member
→ ensemble distribution across those member statistics
```

Member and grid dimensions are never flattened into one pseudo-sample population. `maxMemberSamples` and `maxMemberGridPoints` guard the potentially expensive ensemble dimensions.

## Diagnostics

AIGEFS exposes:

- layer diagnostics;
- structural profile diagnostics;
- diagnostic time ranges.

All nonlinear diagnostics are member-first.

Parcel diagnostics are intentionally unsupported. The operational AIGFS/AIGEFS surface inventory exposed by WFG does not contain the complete surface-pressure, surface-height and near-surface moisture state required by the common parcel initialization kernel. WFG fails explicitly rather than fabricating that state.

## Run selection

Supported selectors are:

- `latest`;
- `latest_complete`;
- explicit timezone-aware cycle.

A common run is resolved once for the ensemble before member sampling. This prevents individual members from silently drifting onto different cycles.

## Example

```json
{
  "dataset": "aigefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-30T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind"],
    "pressureLevelsHpa": [850, 700],
    "fields": ["temperature_2m"]
  },
  "ensemble": {
    "members": ["000", "001", "002"],
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

Omit `members` to use the full 31-member population. `includeMembers: true` may be used for bounded single-time queries when raw member payloads are genuinely needed; range queries remain compact.

## Current comparison boundary

AIGEFS is queryable and diagnosable through the common engine, but run-to-run and cross-dataset comparison strategies are not declared until the comparison-strategy registry can express their scientific meaning cleanly. In particular, GEFS↔AIGEFS should compare aligned distributions rather than pairing member labels or applying generic subtraction.

That is an intentional capability boundary, not a transport limitation.
