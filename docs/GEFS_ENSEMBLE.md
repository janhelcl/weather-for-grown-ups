# GEFS ensemble access

WFG exposes NOAA's Global Ensemble Forecast System as a **model-native ensemble**, not as a hidden confidence score wrapped around deterministic GFS.

GEFS shares model-independent meteorological kernels with GFS where scientifically valid, while member identities, distributions, spatial statistics and run semantics remain explicit.

## GEFS source contract

- pressure/profile product: operational atmospheric `pgrb2a` 0.5°;
- selected-field product: `pgrb2s` 0.25° for field-only requests through `f240`;
- fallback/mixed-field rule: `pgrb2a` 0.5° for mixed pressure/field requests and field-only leads after `f240`;
- members: control `c00` plus perturbed `p01`–`p30`;
- cycles: 00/06/12/18Z;
- WFG forecast horizon: `f000`–`f384`;
- native cadence: 3 hours;
- source: NOAA AWS Open Data `.idx` inventories + byte ranges;
- normal decoder: bundled npm GRIB2 decoder;
- optional compatibility/debug decoder: native `wgrib2`;
- immutable local selected-slice caching.

### Retrospective GEFSv12 reforecasts

Operational GEFS and GEFSv12 reforecasts share member-first physical/statistical kernels, but they are different forecast populations. WFG therefore keeps the public dataset as `gefs` and requires an explicit `forecast.kind: "reforecast"` to cross that boundary.

The reforecast branch deliberately exposes only combinations whose source semantics are already verified:

- NOAA AWS Open Data `GEFSv12/reforecast`, public years 2000–2019;
- explicit daily 00Z initialization;
- point + one valid time or a bounded compact valid-time range;
- default five-member daily ensemble `c00,p01..p04`;
- optional `p05..p10` where the weekly extended run publishes them;
- supported single-level fields: surface pressure, 2 m temperature, 10 m U/V/wind, total precipitation, precipitable water, total-atmosphere cloud cover and mean-sea-level pressure;
- native pressure variables: temperature, U/V wind, geopotential height, vertical velocity and specific humidity;
- immutable variable-file `.idx` inventories + exact forecast-hour byte ranges.

The retrospective pressure archive is not one uniform horizontal grid. Through +240 h, pressure levels at/below 700 hPa are published in the 0.25° base files while levels above 700 hPa are in 0.5° `_abv700mb` files. WFG therefore keeps lower-only profiles on 0.25°, upper-only profiles on 0.5°, and samples mixed profiles on a shared 0.5° point so the returned vertical column has one truthful `gridPoint`. After +240 h, the standard retrospective horizon is 0.5° / 6-hour output.

A reforecast query is **not** an archived operational GEFS query. Point ranges preserve the retrospective native cadence: 3-hour steps from f003 through f240, then 6-hour steps from f246 through f384. Grid point and horizontal-grid provenance are reported per step because lower-air field/profile ranges can cross the 0.25° → 0.5° transition. Raw member payloads remain single-time only; ranges return compact member-first summaries. Multi-point/transect/area operations, diagnostics, derived pressure thermodynamics, calibration metrics and the weekly +35-day horizon remain follow-up layers and fail explicitly.

## Current GEFS capabilities

The current implementation includes:

- searchable GEFS catalog and source semantics;
- scalar raw field distributions;
- multi-variable/multi-level pressure profiles;
- member-first derived pressure thermodynamics;
- mixed pressure/non-isobaric field bundles;
- raw and mixed-field time series;
- raw and mixed-field multi-point queries;
- raw and mixed-field multi-point time series;
- member-first layer diagnostics;
- member-first freezing/inversion diagnostics;
- member-first parcel/LCL/LFC/EL/CAPE/CIN diagnostics;
- layer/profile/parcel diagnostic time series;
- ensemble-native mixed-field transects;
- member-first bounded-area statistics;
- run-to-run distribution comparison;
- aligned deterministic GFS-vs-GEFS comparison.

The older limitations around GEFS parcel diagnostics, multi-point time series, transects and area statistics no longer apply.

## Pressure-profile variables

Native GEFS `pgrb2a` pressure variables currently include:

- `temperature`
- `relative_humidity`
- `u_wind`
- `v_wind`
- `geopotential_height`
- `vertical_velocity` at its explicitly supported pressure surface

Member-first derived profile variables include:

- `dew_point`
- `potential_temperature`
- `specific_humidity`
- `mixing_ratio`
- `virtual_temperature`
- `air_density`
- `wet_bulb_temperature`
- `equivalent_potential_temperature`

Availability remains product-specific and is validated against the WFG GEFS catalog. Derived values are available only where every raw dependency exists at the requested pressure level.

## Member-first semantics

For nonlinear meteorology, WFG never derives a quantity from an ensemble-mean atmospheric profile unless an operation explicitly defines that quantity.

The pattern is:

```text
selected GEFS member
      ↓
fetch minimal raw dependencies
      ↓
normalize one member's atmospheric state
      ↓
run shared physical calculation
      ↓
repeat for selected members
      ↓
summarize member results
```

That pattern applies to thermodynamic derivations, lapse rate, shear, stability gradients, inversion/freezing structures and parcel diagnostics.

All numeric ensemble distribution surfaces share arithmetic mean, population standard deviation, extrema and caller-selected quantiles. Threshold/event fractions are explicitly raw member evidence, **not calibrated probability**.

## Unified surface guide

### Catalog

```bash
wfg catalog --dataset gefs --search cloud --json
```

MCP: `search_catalog` with `datasets: ["gefs"]`.

### Retrospective field distribution

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

MCP uses the same `query_atmosphere` request with `forecast.kind = "reforecast"`. Result provenance identifies `gefs_v12_reforecast` and `archiveType = "reforecast"`.

### Retrospective pressure profile

```bash
wfg query \
  --dataset gefs \
  --forecast-kind reforecast \
  --run 2017-03-14T00:00:00Z \
  --lat 50.08 --lon 14.43 \
  --at 2017-03-14T12:00:00Z \
  --vars temperature,specific_humidity \
  --levels 850,700,500 \
  --members c00,p01,p02,p03,p04 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The request shape is identical to an operational GEFS profile except for the explicit reforecast population. Result provenance adds `profileGridPolicy` so a caller can distinguish native 0.25°/0.5° profiles from a coherent 0.5° column assembled across the retrospective archive's pressure-file split.

### Retrospective time range

```bash
wfg query \
  --dataset gefs \
  --forecast-kind reforecast \
  --run 2017-03-14T00:00:00Z \
  --lat 50.13 --lon 14.37 \
  --from 2017-03-23T21:00:00Z \
  --to 2017-03-24T12:00:00Z \
  --fields temperature_2m \
  --members c00,p01 \
  --quantiles 0.5 \
  --json
```

This range crosses the retrospective day-10 boundary. The returned forecast hours are f237, f240, f246 and f252: there is intentionally no f243. Each step carries its own `gridPoint`, `horizontalGridDegrees` and lead-block provenance, so the 0.25°/3-hour to 0.5°/6-hour source transition is visible rather than normalized away. Pressure-profile ranges use the same public range vocabulary and retain `profileGridPolicy` per step. Use a single valid time when raw member payloads are required.

### Scalar ensemble distribution

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `query_atmosphere`.

### Pressure profile

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height \
  --levels 1000,925,850,700,500 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `query_atmosphere`.

Member profiles are omitted by default and can be requested for audit/composition.

### Mixed field bundle

GEFS mixed bundles combine pressure variables/levels with supported non-isobaric fields in one member-first query.

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m,total_atmosphere_cloud_cover \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The same `query` / `query_atmosphere` operation also handles GEFS time ranges, multiple points, and point × time matrices by changing only `geometry` and `time`.

See [GEFS_FIELD_BUNDLES.md](GEFS_FIELD_BUNDLES.md).

### Multi-point and time-series queries

Use `query --dataset gefs` / `query_atmosphere` with `geometry.type = points` and/or a time range. There are no separate raw-field public commands.

### Layer diagnostics

```bash
wfg diagnose \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --kind layer \
  --lower 850 --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --json
```

Every member gets its own endpoint fields and geopotential layer depth before the diagnostic distribution is summarized.

MCP: `diagnose_atmosphere`.

### Whole-profile diagnostics

```bash
wfg diagnose \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --kind profile \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --json
```

Variable-length structures are summarized through event/count and conditional descriptor distributions rather than an invented ensemble-mean structure.

MCP: `diagnose_atmosphere`. See [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md).

### Parcel diagnostics

GEFS supports the same explicit parcel definitions as GFS, evaluated member by member:

- `surface_2m`
- `mixed_layer_100hpa`
- `most_unstable_300hpa`

Use the same diagnostic operation:

```bash
wfg diagnose \
  --dataset gefs \
  --lat 45.80 --lon 11.77 \
  --at 2026-08-24T12:00:00Z \
  --kind parcel \
  --parcel surface_2m \
  --levels 1000,925,850,700,500,250,200 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

MCP: `diagnose_atmosphere`.

### Diagnostic time series

Use `diagnose --dataset gefs --from ... --to ...` or MCP `diagnose_atmosphere` with a time range. Layer, profile and parcel series share the same member-first diagnostic engine.

See [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md).

### Transect

```bash
wfg query \
  --dataset gefs \
  --start 45.80,11.77 \
  --end 46.50,12.50 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --fields wind_10m \
  --samples 10 \
  --json
```

GEFS transects are ensemble-native mixed-field cross-sections. The path delegates to one multi-point bundle request so selected member slices are reused across coordinates.

MCP: `query_atmosphere`. See [GEFS_TRANSECT.md](GEFS_TRANSECT.md).

### Area statistics

```bash
wfg query \
  --dataset gefs \
  --north 56 --south 55 \
  --west 7 --east 9 \
  --at 2026-08-24T12:00:00Z \
  --vars u_wind --levels 850 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

WFG computes the requested spatial statistic independently within every member, then summarizes those member-level statistics across the ensemble. It does not flatten member × grid-cell values into one distribution.

MCP: `query_atmosphere`.

### Run comparison

```bash
wfg compare-runs \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T18:00:00Z \
  --vars temperature \
  --levels 850 \
  --cycles 3 \
  --json
```

Each initialization is summarized independently. WFG compares distribution descriptors across cycles and deliberately does not treat `p01(new) - p01(old)` as a physical member trajectory.

MCP: `compare_runs`. See [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md).

### Aligned GFS-vs-GEFS comparison

`compare-datasets` / `compare_datasets` resolves one initialization cycle capable of satisfying both datasets and places deterministic GFS inside the GEFS member distribution without inventing a binary confidence judgment.

See [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md).

## Run selection and consistency

`latest` resolves once for the complete query. Multi-time operations keep one cycle fixed across every valid step. Member sets and quantiles remain fixed too. Field-only ranges also pin one source product and grid: a range wholly within `f240` may use `pgrb2s` 0.25°, while any range extending beyond `f240` uses `pgrb2a` 0.5° throughout rather than changing grid mid-series.

Within point/profile operations, selected fields for one member must resolve consistently to one model grid point, and selected members must resolve consistently for the sampled location. Spatial-temporal compositions additionally guard against grid drift where their contracts require stable sampling.

## Data access and caching

GEFS uses NOAA AWS Open Data. WFG selects between member-specific `pgrb2a` 0.5° and `pgrb2s` 0.25° objects according to the query contract, caches `.idx` inventories, selects only required byte ranges, stores immutable selected-message slices and performs decoding, sampling, derivation and aggregation locally. Cache identity includes the source product, so 0.25° and 0.5° slices cannot collide.

Mixed bundles merge dependencies so one member query does not need a separate upstream object transfer per requested normalized output. Multi-point and transect operations reuse those member slices across coordinates.

AWS Open Data paths do not use the NOMADS scripted-access limiter.

## Explicit non-goals

WFG does not turn GEFS spread into a calibrated confidence score, choose weather-dependent activities, produce safety advice, or hide model disagreements behind one convenience number.

Those interpretations belong to the consuming agent or a domain-specific layer built on WFG.
