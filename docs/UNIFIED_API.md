# Unified atmospheric API

WFG's public API is organized around a small operation vocabulary and four atmospheric datasets.

> **One query language for atmospheric state; datasets preserve their semantics.**

## Datasets

| Public ID | Internal dataset | Role | Result semantics |
| --- | --- | --- | --- |
| `gfs` | `gfs_0p25` / `gfs_0p50` operational; grid-matched 0.25° GDEX or 0.5° NCEI archive for old explicit runs | forecast | deterministic |
| `gefs` | `gefs_0p50` model contract; 0.5° pressure/mixed source plus 0.25° selected-field source through f240 | forecast | member-first ensemble |
| `ifs` | `ifs_0p25` ECMWF Open Data operational forecast | forecast | deterministic |
| `gfs-analysis` | `gfs_grid4_analysis_0p5` | historical analysis | deterministic analyzed state |

The first IFS implementation supports point geometry at one valid time with canonical pressure variables and selected fields; unsupported IFS geometries/ranges fail explicitly rather than falling through to another dataset. The short public IDs are query vocabulary. Full internal dataset IDs remain visible in result metadata/provenance. Historical forecasts are deliberately **not** a fourth public dataset: an explicit old `forecast.run` still uses `dataset: "gfs"`, while WFG resolves the backing archive transparently.

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
- an old explicit GFS run transparently resolves to the archive matching `forecast.grid`: NCAR/GDEX d084001 for `0p25`, NOAA NCEI Grid 4 for `0p50`;
- historical analysis retains analysis time;
- WFG never invents a forecast run/lead for analysis data.

Archived forecasts preserve grid-native historical semantics. The 0.25° NCAR/GDEX d084001 archive begins 2015-01-15 and exposes 3-hour output through f240 followed by 12-hour output from f252 through f384. The 0.5° NOAA NCEI Grid 4 archive begins 2006-10-10 and exposes 3-hour output through f192. Direct online availability can vary; unavailable archive files fail clearly rather than being substituted with a different grid or product.

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

For `gefs`, source resolution follows selection semantics rather than adding another public dataset. Field-only requests use the 0.25° selected-field product through `f240`. Any pressure-level selection, including a mixed pressure/field bundle, uses the 0.5° pressure product. A field-only time range that extends beyond `f240` uses 0.5° for the entire range so sampling resolution cannot change between steps.

## MCP tools

The compact public vocabulary is:

| Tool | Purpose |
| --- | --- |
| `search_catalog` | Discover canonical fields/diagnostics and dataset support |
| `query_atmosphere` | Raw/derived atmospheric state over supported geometry and time |
| `diagnose_atmosphere` | Layer, profile and parcel meteorology |
| `compare_runs` | Compare consecutive forecast initialization cycles |
| `compare_datasets` | Compare aligned datasets; currently GFS against GEFS |
| `verify_forecast` | Compare an archived GFS forecast with later GFS analysis or an IGRA radiosonde |
| `find_analogs` | Search materialized historical atmospheric analogs |

`verify_forecast` has two reference semantics. The default `referenceDataset: "gfs-analysis"` preserves the original same-grid analysis-minus-forecast comparison. `referenceDataset: "igra"` uses NOAA IGRA v2.2 radiosonde observations: an explicit `stationId` may be supplied or WFG chooses the nearest station covering the requested year within `maxStationDistanceKm`; the forecast is sampled at the sounding location and only exact observed pressure levels are compared. IGRA therefore appears as a verification reference, not as a `query_atmosphere` dataset.

Atomic verification uses `time: { at }` and one numeric `leadHours`. Bounded skill summaries use `time: { from, to, hoursUtc?, maxValidTimes? }` and an array of up to three `leadHours` for either reference. The summary is bounded to eight sampled nominal times and 24 forecast evaluations. If more eligible times exist, WFG chooses an evenly spaced deterministic sample and reports both eligible and sampled counts. Every evaluation remains visible as success/failure, and statistics include their own sample counts. With `referenceDataset: "gfs-analysis"`, metrics summarize native 0.5° Grid 4 analysis-minus-forecast deltas. With `referenceDataset: "igra"`, they summarize observation-minus-forecast deltas and retain the radiosonde stations used. Both modes report bias, MAE and RMSE independently by lead, pressure and field.

Index materialization/backfill is an administrative concern and is intentionally CLI-only. Historical analog profiles use `wfg index build` / `wfg index backfill`; large verification corpora use `wfg index verification-backfill` and are summarized locally with `wfg index verification-summary`. These administrative operations are not added to the normal seven-tool MCP weather catalog.

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

What GFS predicted in the past uses the same `gfs` dataset with an explicit old run:

```json
{
  "dataset": "gfs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "forecast": {
    "run": "2019-12-24T12:00:00Z",
    "grid": "0p25"
  },
  "time": {
    "at": "2019-12-26T18:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  }
}
```

This means “what did the 2019-12-24 12Z GFS 0.25° run predict for 2019-12-26 18Z?” The result keeps `dataset: "gfs"` but exposes `internalDatasetId: "gfs_0p25_forecast_archive"` and NCAR/GDEX provenance. Select `grid: "0p50"` to query the NCEI Grid 4 archive instead.

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
    "at": "2019-12-26T18:00:00Z"
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

- GFS carries deterministic values and forecast metadata; `forecast.grid` selects 0.25° or 0.5° operational data and the matching historical forecast archive while retaining the public `gfs` ID.
- GEFS carries member-derived distributions and optional members.\n- IFS carries deterministic 0.25° values with explicit ECMWF run, lead, sampled grid point, product and source provenance. The stable `gefs_0p50` internal model identity denotes the pressure/profile contract; `result.source.product` and `result.source.horizontalGridDegrees` expose whether an eligible field-only query used `pgrb2s` 0.25° or the `pgrb2a` 0.5° source.
- historical GFS analysis carries deterministic analyzed values and NCEI provenance.

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

Historical forecast: keep the dataset as GFS and select the old initialization.

```bash
wfg query \
  --dataset gfs \
  --grid 0p25 \
  --run 2019-12-24T12:00:00Z \
  --lat 50.08 --lon 14.43 \
  --at 2019-12-26T18:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --json
```

The same routing applies to `wfg diagnose`: `--grid 0p25|0p50` selects the deterministic GFS grid, and an old explicit `--run` derives layer, profile, parcel, or diagnostic time-series products from the matching archived forecast state.

Historical analysis: change the dataset and time.

```bash
wfg query \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --at 2019-12-26T18:00:00Z \
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
  --at 2019-12-26T18:00:00Z \
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
- archived GFS forecasts preserve grid-native cadence and inventory: 0.25° GDEX uses 3-hour steps through +240 h then 12-hour steps through +384 h, while 0.5° Grid 4 uses 3-hour steps through +192 h;
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
