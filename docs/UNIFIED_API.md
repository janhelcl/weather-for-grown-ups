# Unified atmospheric API

WFG's public API is organized around a small operation vocabulary and a growing atmospheric dataset registry.

> **One query language for atmospheric state; datasets preserve their semantics.**

## Datasets

| Public ID | Internal dataset | Role | Result semantics |
| --- | --- | --- | --- |
| `gfs` | `gfs_0p25` / `gfs_0p50` operational; grid-matched 0.25° GDEX or 0.5° NCEI archive for old explicit runs | forecast | deterministic physics model |
| `aigfs` | `aigfs_0p25` NOAA operational AIGFS | forecast | deterministic AI model |
| `aigefs` | `aigefs_0p25` NOAA operational AIGEFS | forecast | 31-member AI ensemble |
| `hgefs` | `hgefs_0p25` NOAA operational hybrid population | forecast | 62-member GEFS + AIGEFS hybrid ensemble |
| `icon-d2` | `icon_d2_0p02` DWD regional forecast | forecast | deterministic convection-permitting physics model |
| `icon-d2-eps` | `icon_d2_eps_2p1km` DWD regional ensemble | forecast | 20-member convection-permitting ensemble |
| `arome` | `arome_0p01` Météo-France AROME / EURW1S100 public product | forecast | deterministic limited-area field-only capability |
| `aifs` | `aifs_0p25` ECMWF AIFS Single | forecast | deterministic AI forecast |
| `aifs-ens` | `aifs_ens_0p25` ECMWF AIFS ENS | forecast | 51-member stochastic AI ensemble |
| `gefs` | operational `gefs_0p50`; explicit `forecast.kind=reforecast` resolves to `gefs_v12_reforecast` for supported retrospective queries | forecast | member-first ensemble |
| `ifs` | `ifs_0p25` ECMWF Open Data operational forecast | forecast | deterministic |
| `ifs-ens` | `ifs_ens_0p25` ECMWF Open Data ENS direct output | forecast | 50-member perturbed distribution |
| `gfs-analysis` | `gfs_grid4_analysis_0p5` | historical analysis | deterministic analyzed state |

`aigfs` keeps the same public state vocabulary while preserving its narrower native product: 0.25°, 00/06/12/18Z initializations, 6-hour output through f384, six native pressure variables and a small surface-field set. It supports point/range, multi-point/range, transect, scalar area, layer and structural profile diagnostics. Parcel diagnostics are explicitly absent because the operational surface product lacks the complete parcel initialization state used by WFG. See [AIGFS.md](AIGFS.md).

`aigefs` preserves the same AI-state inventory while changing the result semantics to a 31-member ensemble on the native 0.25° / 6-hour / f384 product. WFG evaluates deterministic normalization and nonlinear layer/profile diagnostics independently inside each selected member before aggregation. Parcel diagnostics and comparison operations are not advertised yet. See [AIGEFS.md](AIGEFS.md).

`arome` preserves two different grid truths at once: the operational AROME model has a nominal ~1.3 km limited-area mesh, while the current WFG source is Météo-France's regular 0.01° EURW1S100 public delivery product. The current integration exposes its verified near-surface/height field inventory across point/range/multi-point/transect/area geometry and deliberately does not mix in pressure levels from the separate 0.025° package family. Pressure diagnostics therefore fail explicitly. See [AROME.md](AROME.md).

`hgefs` composes 31 GEFS physics members with 31 AIGEFS AI members under one common 00/06/12/18Z initialization, native 6-hour output and f240 horizon. Member IDs are population-qualified (`gefs:c00..p30`, `aigefs:c00..p30`). WFG only exposes the scientifically compatible inventory intersection, computes nonlinear diagnostics inside each constituent member, and preserves constituent-native grids rather than inventing one homogeneous grid. See [HGEFS.md](HGEFS.md).

AIFS ENS uses the same canonical AIFS atmospheric inventory while preserving its native stochastic member population: a dedicated control `c00` and 50 perturbations `p01..p50`. The control is an AIFS ENS forecast, not AIFS Single; ECMWF packages it as `cf` while perturbations live in the indexed `pf` product. WFG evaluates state normalization and nonlinear layer/profile diagnostics independently inside each member before aggregation. See [AIFS_ENS.md](AIFS_ENS.md).

Deterministic IFS supports point and multi-point access, native-cadence ranges, transects, raw scalar bbox area summaries, deterministic diagnostics, and run-to-run comparison while preserving ECMWF-native cadence and field semantics. IFS ENS supports point and multi-point member-first bundles, great-circle transects, member-first scalar area statistics, native-cadence point/multi-point state ranges and diagnostic time ranges, layer/profile/parcel diagnostics, and run-to-run distribution shifts with the same canonical pressure vocabulary, 50 perturbations and requested quantiles. Raw member payloads are opt-in for single-time/state queries; diagnostic ranges and run comparisons stay compact. The Cycle 50r1 unperturbed control is exposed as deterministic `ifs`. Unsupported combinations fail explicitly rather than falling through to another dataset. The short public IDs are query vocabulary. Full internal dataset IDs remain visible in result metadata/provenance. Historical forecasts are deliberately **not** a separate public dataset: an explicit old `forecast.run` still uses `dataset: "gfs"`, while WFG resolves the backing archive transparently. GEFS reforecasts follow the same public-vocabulary principle but preserve a different physical meaning: `dataset: "gefs"` plus `forecast.kind: "reforecast"` selects a retrospective GEFSv12 forecast population, not an archive of whatever operational GEFS happened to run on that date.

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
{ "dataset": "aigfs" }
```

or:

```json
{ "dataset": "aigefs" }
```

or:

```json
{ "dataset": "hgefs" }
```

or:

```json
{ "dataset": "aifs-ens" }
```

or:

```json
{ "dataset": "gefs" }
```

or:

```json
{ "dataset": "ifs-ens" }
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

For operational `gfs`, source selection is normally automatic and is not another query dimension. Point/profile, time-series, multi-point, transect, and run-comparison work prefers NOAA AWS Open Data byte ranges; bounded areas use NOMADS geographic subsetting. An explicit `source: "nomads" | "s3" | "archive"` is an override/debugging control where the chosen geometry supports it. Old explicit forecast runs still route to the grid-matched archive. CLI time-range queries report native-step progress on stderr, leaving JSON stdout machine-readable.

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

Run selection is capability-driven rather than syntactically pretending every forecast source is identical:

| Dataset / population | Run selectors |
| --- | --- |
| GFS operational | `latest`, `latest_complete`, explicit ISO cycle |
| AIGFS operational | `latest`, `latest_complete`, explicit ISO cycle |
| ICON-D2 operational | `latest`, `latest_complete`, explicit ISO cycle |
| ICON-D2-EPS operational | `latest`, `latest_complete`, explicit ISO cycle |
| AROME operational | `latest`, `latest_complete`, explicit ISO cycle |
| GEFS operational | `latest`, explicit ISO cycle |
| IFS operational | `latest`, explicit ISO cycle |
| IFS ENS operational | `latest`, explicit ISO cycle |
| GEFSv12 reforecast | explicit historical 00Z cycle only |
| GFS analysis | no forecast run axis |

`latest` means the newest published cycle that can satisfy the requested valid time/selection. GFS and AIGFS expose `latest_complete` for callers that specifically require a run published through its full horizon. Unsupported selectors fail at the dataset capability boundary; WFG does not manufacture equivalent semantics for sources that do not provide them. The same rule applies to query, diagnostic, run-comparison, and cross-dataset comparison surfaces.

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

For `arome`, the current `arome_0p01` capability is intentionally field-only: 2 m temperature/RH and U/V or derived wind at 10/20/50/100 m. Pressure variables are not resolved from another public AROME resolution behind the caller's back. See [AROME.md](AROME.md).

For `aigfs`, native range sampling is every 6 forecast hours. Pressure-level requests are restricted to the published 50/100/150/200/250/300/400/500/600/700/850/925/1000 hPa surfaces. Pressure variables are temperature, U/V wind, geopotential height, specific humidity and vertical velocity plus derivations whose dependencies exist. Supported surface selections are 2 m temperature, 10 m U/V wind (plus derived `wind_10m`), mean-sea-level pressure and total precipitation. Unsupported state such as pressure-level relative humidity is rejected rather than substituted. Operational access uses cached NOMADS `.idx` inventories and partial HTTP ranges under the shared NOMADS access policy.

For `gefs`, source resolution follows selection semantics rather than adding another public dataset. Field-only requests use the 0.25° selected-field product through `f240`. Any pressure-level selection, including a mixed pressure/field bundle, uses the 0.5° pressure product. A field-only time range that extends beyond `f240` uses 0.5° for the entire range so sampling resolution cannot change between steps.

For GEFSv12 reforecasts, use an explicit historical run and `forecast.kind: "reforecast"`. The surface remains intentionally narrower than operational GEFS: point and multi-point queries support the verified single-level fields, native pressure profiles, or both together at one valid time or across a bounded `from`/`to` range. Daily retrospective runs use five members (`c00,p01..p04`) by default; explicitly selected `p05..p10` are accepted for runs where the weekly extended ensemble exists. The public AWS retrospective spans 2000–2019. Pressure variables currently include temperature, U/V wind, geopotential height, vertical velocity and specific humidity. Native range cadence is 3-hourly from f003 through f240 and 6-hourly from f246 through f384; there is no synthetic f243. Through f240, levels at/below 700 hPa use the retrospective 0.25° base files while upper levels use 0.5° files, and mixed profiles are sampled on one common 0.5° point. Because a range can cross the day-10 boundary, each step reports its own sampled grid point and horizontal-grid provenance; profile steps also preserve `profileGridPolicy`. For mixed pressure/field selections, WFG preserves separate pressure and field grid points and grid provenance because the retrospective files can genuinely resolve the same requested coordinate on different native meshes. Range payloads stay compact and raw member arrays remain single-time only. `diagnose_atmosphere` supports the retrospective subset's three layer diagnostics (`temperature_lapse_rate`, `wind_shear`, `potential_temperature_gradient`) and two structural profile diagnostics (`freezing_level_crossings`, `temperature_inversion_layers`) for instant or bounded range queries. Diagnostics are derived independently for each member before ensemble aggregation, and range steps retain their own sampled grid point, horizontal-grid resolution and `profileGridPolicy`. Parcel diagnostics remain explicit unsupported because the available retrospective subset lacks the surface/moisture inputs required by the parcel kernel. Transect/area geometry, derived pressure thermodynamics and unimplemented archive extensions fail explicitly rather than falling through to operational GEFS.

## MCP tools

The compact public vocabulary is:

| Tool | Purpose |
| --- | --- |
| `search_catalog` | Discover canonical fields/diagnostics and dataset support; use `forecastKind: "reforecast"` with `datasets: ["gefs"]` for the retrospective capability subset |
| `query_atmosphere` | Raw/derived atmospheric state over supported geometry and time |
| `diagnose_atmosphere` | Layer, profile and parcel meteorology |
| `compare_runs` | Compare consecutive GFS, GEFS, IFS, or IFS ENS forecast initialization cycles |
| `compare_datasets` | Compare only registered aligned dataset pairs across physics, AI and hybrid model classes; pair-specific semantics remain explicit |
| `verify_forecast` | Compare an archived GFS forecast with later GFS analysis or an IGRA radiosonde |
| `find_analogs` | Search materialized historical atmospheric analogs |

`search_catalog` returns a top-level `datasetCapabilities` section alongside field/diagnostic matches. It exposes each selected dataset's role, deterministic/ensemble kind, model class, provider, native grid/cadence metadata, hybrid constituent metadata where applicable, forecast populations, supported run selectors, and operations; the CLI `wfg catalog` prints the same capability summary before its match table. This is the canonical discovery surface for source differences rather than requiring callers to learn dataset-specific exceptions.

`search_catalog` defaults to operational capabilities. To plan a GEFSv12 retrospective query, pass `datasets: ["gefs"]` and `forecastKind: "reforecast"`. The result contains only capabilities currently exposed by the reforecast path: the verified retrospective single-level fields, six native pressure variables, three layer diagnostics and two structural profile diagnostics. Derived pressure thermodynamics and parcel diagnostics remain absent because the retrospective source subset does not expose the dependencies needed to support them truthfully. The CLI equivalent is `wfg catalog --dataset gefs --forecast-kind reforecast`.

`compare_datasets` preserves pair-specific semantics under one restrictive registry. Existing physics strategies remain GFS↔GEFS deterministic positioning, GFS↔IFS deterministic deltas, GEFS↔IFS ENS distribution shifts, and IFS↔IFS ENS deterministic-control positioning. The model-class line adds GFS↔AIGFS, IFS↔AIFS and AIGFS↔AIFS deterministic deltas; GEFS↔AIGEFS and IFS ENS↔AIFS ENS independent distribution shifts; and HGEFS↔GEFS / HGEFS↔AIGEFS hybrid-to-constituent distribution shifts. Cross-ensemble member labels are never paired as trajectories. IFS ENS retains its native 50 perturbations while AIFS ENS retains its dedicated control plus 50 perturbations. HGEFS constituent comparisons are explicitly overlapping rather than statistically independent because the constituent members are part of the hybrid population itself. Deterministic differences, ensemble spread/quantile shifts and raw member fractions are descriptive model evidence, not verification error or calibrated uncertainty. Unsupported dataset pairs fail at the registry boundary rather than falling through to generic subtraction.

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


A retrospective GEFSv12 field question keeps the same public dataset and changes forecast population explicitly:

```json
{
  "dataset": "gefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "forecast": {
    "kind": "reforecast",
    "run": "2017-03-14T00:00:00Z"
  },
  "time": {
    "at": "2017-03-14T12:00:00Z"
  },
  "selection": {
    "fields": ["temperature_2m", "wind_10m"]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

That result keeps `dataset: "gefs"` but exposes `internalDatasetId: "gefs_v12_reforecast"` and retrospective NOAA AWS provenance. It must not be interpreted as “the operational GEFS forecast issued on 2017-03-14”.

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
- GEFS carries member-derived distributions and optional members. Operational queries use the `gefs_0p50` internal model contract while provenance exposes the actual 0.25°/0.5° product. Explicit retrospective queries use `internalDatasetId: "gefs_v12_reforecast"`, `source.archiveType: "reforecast"`, and the native retrospective grid/cadence semantics.
- IFS carries deterministic 0.25° values with explicit ECMWF run, lead, sampled grid point, product and source provenance.
- AIFS ENS carries distributions over the selected `c00,p01..p50` stochastic AI members while keeping AIFS Single separate.
- IFS ENS carries distributions across the requested `p01`–`p50` perturbed members, requested quantiles, and optional raw members where the operation permits them; deterministic IFS remains the separate unperturbed-control dataset.
- Historical GFS analysis carries deterministic analyzed values and NCEI provenance.

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

The parcel/layer/profile physics are shared. GEFS and IFS ENS evaluate nonlinear diagnostics member by member before aggregation.

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

GEFSv12 retrospective forecast:

```bash
wfg query \
  --dataset gefs \
  --forecast-kind reforecast \
  --run 2017-03-14T00:00:00Z \
  --lat 50.08 --lon 14.43 \
  --at 2017-03-14T12:00:00Z \
  --fields temperature_2m,wind_10m \
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

- historical NCEI operations have tighter point/sample/time bounds because archive access is file/NCSS oriented and NOAA-paced;
- archived GFS forecasts preserve grid-native cadence and inventory: 0.25° GDEX uses 3-hour steps through +240 h then 12-hour steps through +384 h, while 0.5° Grid 4 uses 3-hour steps through +192 h;
- historical analysis does not expose forecast accumulation products as if they were instantaneous analysis state;
- ensemble-only controls are rejected for deterministic datasets;
- HGEFS member IDs must retain their `gefs:` or `aigefs:` population prefix and HGEFS selections must exist in both constituent inventories;
- forecast run controls are rejected for `gfs-analysis`;
- transport failures remain distinct from capability failures: an exhausted NCEI 5xx response is reported as upstream source unavailability rather than "unsupported data";
- retrospective archive inventory can vary by run/file even inside a globally supported capability; those errors report the requested variable/level and what the decoded file actually contains.

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
