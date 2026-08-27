# Unified atmospheric API

WFG's public API is organized around a small operation vocabulary and three atmospheric datasets.

> **One query language for atmospheric state; datasets preserve their semantics.**

## Datasets

| Public ID | Internal dataset | Role | Result semantics |
| --- | --- | --- | --- |
| `gfs` | `gfs_0p25` | forecast | deterministic |
| `gefs` | `gefs_0p50` | forecast | member-first ensemble |
| `gfs-analysis` | `gfs_grid4_analysis_0p5` | historical analysis | deterministic analyzed state |

The short public IDs are query vocabulary. Full internal dataset IDs remain visible in result metadata/provenance.

## The four orthogonal query dimensions

Normal atmospheric access is:

```text
dataset × geometry × time × selection
```

### Dataset

```json
{ "dataset": "gfs" }
```

Changing only the dataset asks the same atmospheric question of another source:

```json
{ "dataset": "gefs" }
```

or:

```json
{ "dataset": "gfs-analysis" }
```

### Geometry

One point:

```json
{
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  }
}
```

Multiple points:

```json
{
  "geometry": {
    "type": "points",
    "points": [
      { "latitude": 50.08, "longitude": 14.43 },
      { "latitude": 49.20, "longitude": 16.61 }
    ]
  }
}
```

Transect:

```json
{
  "geometry": {
    "type": "transect",
    "start": { "latitude": 48.0, "longitude": 11.0 },
    "end": { "latitude": 50.0, "longitude": 15.0 },
    "samples": 20
  }
}
```

Area:

```json
{
  "geometry": {
    "type": "area",
    "westLongitude": 12,
    "eastLongitude": 18,
    "southLatitude": 48,
    "northLatitude": 51
  }
}
```

Dataset-specific limits remain explicit. For example, historical NCEI transects are more tightly bounded than AWS-backed operational queries.

### Time

One valid atmospheric state:

```json
{ "time": { "at": "2026-08-28T12:00:00Z" } }
```

A range:

```json
{
  "time": {
    "from": "2026-08-28T00:00:00Z",
    "to": "2026-08-29T00:00:00Z",
    "maxSteps": 9
  }
}
```

For `gfs-analysis`, a range may select native analysis cycles:

```json
{
  "time": {
    "from": "2017-05-01T00:00:00Z",
    "to": "2017-05-07T23:59:59Z",
    "hoursUtc": [12],
    "maxSteps": 7
  }
}
```

The caller always asks for an atmospheric state valid at a time. Dataset-native time semantics stay in the result:

- forecasts retain initialization/run and lead;
- historical analysis retains analysis time;
- WFG never invents a forecast run/lead for analysis data.

### Selection

Pressure profile:

```json
{
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  }
}
```

Non-isobaric fields:

```json
{
  "selection": {
    "fields": ["temperature_2m", "wind_10m", "precipitable_water"]
  }
}
```

Where the dataset supports it, the two may be mixed in one request.

## MCP tools

The compact public vocabulary is:

| Tool | Purpose |
| --- | --- |
| `search_catalog` | Discover canonical fields/diagnostics and dataset support |
| `query_atmosphere` | Raw/derived atmospheric state over supported geometry and time |
| `diagnose_atmosphere` | Layer, profile and parcel meteorology |
| `compare_runs` | Compare consecutive forecast initialization cycles |
| `compare_datasets` | Compare aligned datasets; currently GFS against GEFS |
| `verify_forecast` | Compare an archived forecast with a later reference state |
| `find_analogs` | Search materialized historical atmospheric analogs |

Index materialization/backfill is an administrative concern and is intentionally CLI-only through `wfg index build` and `wfg index backfill`; it is not part of the normal MCP weather-tool catalog.

## `query_atmosphere`

A deterministic GFS profile:

```json
{
  "dataset": "gfs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  }
}
```

The same atmospheric question against historical analysis:

```json
{
  "dataset": "gfs-analysis",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2017-05-09T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  }
}
```

And against GEFS:

```json
{
  "dataset": "gefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

The request shape stays stable. The result does not pretend the datasets are statistically identical.

## Result envelope

Unified state/diagnostic operations return a common envelope:

```json
{
  "dataset": "gefs",
  "internalDatasetId": "gefs_0p50",
  "role": "forecast",
  "kind": "ensemble",
  "geometryType": "point",
  "timeType": "instant",
  "result": {}
}
```

`result` remains dataset-native.

- GFS carries deterministic values and forecast metadata.
- GEFS carries member-derived distributions and optional members.
- historical GFS carries deterministic analyzed values and NCEI provenance.

This is deliberate: the API unifies **how the question is expressed**, not the physical meaning of the answer.

## Diagnostics

`diagnose_atmosphere` shares the same dataset/point/time vocabulary.

Layer shear:

```json
{
  "dataset": "gefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "diagnostic": {
    "kind": "layer",
    "lowerPressureHpa": 850,
    "upperPressureHpa": 500,
    "diagnostics": ["wind_shear"]
  }
}
```

Parcel time series over historical analyses:

```json
{
  "dataset": "gfs-analysis",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "from": "2017-05-01T00:00:00Z",
    "to": "2017-05-07T23:59:59Z",
    "hoursUtc": [12],
    "maxSteps": 7
  },
  "diagnostic": {
    "kind": "parcel",
    "parcel": "surface_2m",
    "pressureLevelsHpa": [1000, 925, 850, 700, 500, 300]
  }
}
```

The parcel/layer/profile physics are shared. GEFS evaluates nonlinear diagnostics member by member before aggregation.

## CLI

The same vocabulary is available to humans.

Operational forecast:

```bash
wfg query \
  --dataset gfs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --json
```

Historical analysis: change the dataset and time.

```bash
wfg query \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --json
```

GEFS:

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Discovery:

```bash
wfg catalog --dataset all --search wind --json
```

Diagnostics:

```bash
wfg diagnose \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --kind layer \
  --lower 850 --upper 500 \
  --diagnostics wind_shear \
  --json
```

Specialized CLI operations are `compare-runs`, `compare-datasets`, `verify`, and `analogs`.

## Capability differences are errors, not fake symmetry

A common query vocabulary does not mean every dataset/source implements every combination.

Examples:

- current operational GFS transects expose pressure-level selection but not the full mixed-field selection available to GEFS/history transects;
- historical NCEI operations have tighter point/sample/time bounds because archive access is file/NCSS oriented and NOAA-paced;
- historical analysis does not expose forecast accumulation products as if they were instantaneous analysis state;
- ensemble-only controls are rejected for deterministic datasets;
- forecast run controls are rejected for `gfs-analysis`.

The unified dispatcher delegates to the existing dataset-specific schemas after interpreting the common request. Unsupported combinations therefore fail explicitly at the capability boundary.

## Administrative indexing

Historical analog search uses a local materialized index. Index construction is deliberately outside the atmospheric MCP catalog:

```bash
wfg index build \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --from 2017-05-01T00:00:00Z \
  --to 2017-05-08T23:59:59Z \
  --cycles 12 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --json

wfg index backfill \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --from 2007-01-01T00:00:00Z \
  --to 2026-08-01T23:59:59Z \
  --cycles 12 \
  --max-fetches 32 \
  --json
```

The normal MCP surface remains exactly the seven atmospheric tools listed above.
