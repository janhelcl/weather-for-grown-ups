# Cross-scale dataset comparison

WFG supports **point-only** comparison between selected global and regional forecast families through the same `compare_datasets` operation.

The architecture is intentionally restrictive. A regional grid is not treated as a higher-resolution version of a global grid, and WFG does not expose a generic “subtract any two datasets” fallback.

## Registered pairs

| Pair | Selection contract | Shared valid-time cadence | Regional horizon |
| --- | --- | ---: | ---: |
| IFS ↔ ICON-D2 | declared pressure intersection or instantaneous 2 m / 10 m fields | 3 h | 48 h |
| IFS ↔ AROME | instantaneous 2 m / 10 m / 100 m field intersection | 3 h | 51 h |
| GFS ↔ ICON-D2 | declared pressure intersection or instantaneous 2 m / 10 m / MSLP fields | 1 h | 48 h |
| IFS ENS ↔ ICON-D2-EPS | scalar pressure or instantaneous scalar field distributions | 3 h | 48 h |
| IFS ENS ↔ PE-AROME | 2 m temperature or relative-humidity distributions | 3 h | 51 h |

The request must use an **explicit shared 00/06/12/18Z initialization**. WFG does not independently resolve `latest` on two providers and then compare different forecast ages.

The valid time must be available on both native forecast cadences and inside the shorter regional horizon.

## Spatial semantics

A comparison request supplies one requested latitude/longitude.

Each dataset then performs its normal point sampling independently:

1. the requested point must be inside both declared dataset domains;
2. each dataset resolves that point on its own access/native-grid path;
3. the comparison layer does **no cross-dataset interpolation or regridding**;
4. the two sampled grid points may differ and are preserved separately;
5. each side keeps its native-grid metadata and source provenance.

That means a delta is a difference between the two model values sampled for the same requested coordinate. It is **not** a claim that the models share a grid cell, effective resolution, representativeness scale or resolved physics.

Area-to-area or grid-cell subtraction is deliberately unsupported. Adding it later would require an explicit target-grid/aggregation methodology and scale-aware interpretation rather than reusing point semantics.

## Deterministic selections

### IFS ↔ ICON-D2

Pressure variables:

- temperature
- relative humidity
- U/V wind
- geopotential height
- vertical velocity
- vector wind
- dew point
- potential temperature

Shared pressure levels are 300, 400, 500, 600, 700, 850, 925 and 1000 hPa.

Instantaneous fields are 2 m temperature plus U/V/vector wind at 10 m.

### GFS ↔ ICON-D2

The ICON-D2 pressure inventory is the restrictive side of the declared pressure intersection.

Instantaneous fields are 2 m temperature, U/V/vector wind at 10 m and mean sea-level pressure. Accumulated precipitation is intentionally excluded from the initial cross-scale contract because accumulation-window semantics must not be inferred from matching field names.

### IFS ↔ AROME

The current public AROME 0.01° product is field-oriented rather than pressure-profile symmetric with IFS. The declared intersection is:

- 2 m temperature
- 2 m relative humidity
- U/V/vector wind at 10 m
- U/V/vector wind at 100 m

This is why the comparison architecture supports both pressure selections and canonical non-isobaric fields instead of forcing every pair through a pressure-only helper.

## Ensemble selections

IFS ENS ↔ ICON-D2-EPS supports scalar pressure variables from the deterministic pressure intersection, except vector wind because one ensemble comparison output must be scalar. It also supports 2 m temperature and the scalar 10 m U/V wind components.

IFS ENS ↔ PE-AROME follows the currently substantiated PE-AROME inventory: 2 m temperature and 2 m relative humidity.

Ensemble comparison preserves each model's native population. Distributions are compared independently; member labels are **not paired across forecast systems**. Reported mean/spread/quantile shifts and threshold member fractions are descriptive raw-model evidence, not calibrated uncertainty or verification error.

## Example

~~~json
{
  "datasets": ["ifs", "arome"],
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-09-01T12:00:00Z"
  },
  "run": "2026-09-01T06:00:00Z",
  "field": "wind_100m"
}
~~~

The result includes:

- exact shared run, valid time and forecast hour;
- the requested point;
- explicit selection/output units;
- alignment methodology;
- separate left/right sampled grid points;
- per-side spatial domain/native-grid metadata and source provenance;
- deterministic output deltas or ensemble distribution shifts.

## Architectural rule

A new global ↔ regional pair is not enabled because both datasets happen to accept the same public field name.

It must be added as a registered strategy with a scientifically reviewed declaration covering:

- spatial-domain overlap;
- run and valid-time alignment;
- compatible selections;
- point-sampling behavior;
- interpolation/regridding policy;
- native-resolution representation;
- output semantics;
- provenance semantics.

Unsupported pairs fail rather than falling through to generic subtraction.
