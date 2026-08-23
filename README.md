# Weather for Grown Ups

Agent-native access to NOAA GFS data: one TypeScript core, thin CLI and MCP surfaces.

The project intentionally exposes the atmospheric model rather than interpreting it. It normalizes NOAA/GFS naming, handles pressure-level and non-isobaric field queries, manages upstream access constraints, caches immutable forecast slices, and returns structured values suitable for agents.

## Discover the atmospheric catalog

```bash
wfg catalog
wfg catalog --json
```

MCP exposes the same information through `get_gfs_catalog`. WFG only accepts pressure levels published by the GFS 0.25° isobaric product, including fractional upper-atmosphere levels down to 0.01 hPa. An arbitrary level such as 842 hPa is rejected before any network request.

Supported pressure-level variables include temperature, relative humidity, U/V wind, geopotential height, specific humidity, pressure/geometric vertical velocity, absolute vorticity, total cloud cover, cloud-water mixing ratio, and ozone mixing ratio. Deterministic derived variables include wind speed/direction, dew point, potential temperature, mixing ratio, virtual temperature, moist-air density, wet-bulb temperature, and equivalent potential temperature.

Derived variables declare their raw GFS dependencies in the catalog. WFG fetches only those raw dependencies, validates that the requested pressure profile is complete, then computes the requested derivation locally. These are physical transforms rather than activity-specific scores or forecast interpretation.

The same catalog advertises deterministic diagnostics across two pressure surfaces: environmental temperature lapse rate, vector wind shear, and potential-temperature gradient. It also advertises sampled whole-profile diagnostics (all freezing-level crossings and temperature-inversion layers) and explicit parcel definitions for LCL/LFC/EL/CAPE/CIN. Diagnostics declare raw dependencies centrally so several calculations can share one minimal GFS profile fetch.

The catalog also exposes non-isobaric fields with explicit vertical and temporal semantics:

- surface pressure, surface geopotential height, surface temperature, gust, surface CAPE/CIN, and boundary-layer height
- 2 m temperature, relative humidity, specific humidity, and dew point
- U/V and derived wind at 10, 20, 30, 40, 50, 80, and 100 m above ground
- 80 m temperature, specific humidity, and pressure; 100 m temperature
- accumulated total precipitation, with its exact GFS forecast-hour accumulation interval
- whole-atmosphere products including precipitable water, cloud water, relative humidity, total ozone, and cloud work function
- low/middle/high and whole-atmosphere cloud cover, including both instantaneous and forecast-window-average products where GFS publishes both
- cloud ceiling, convective cloud base/top pressure, low/middle/high cloud base/top pressure, low/middle/high cloud-top temperature, convective cloud cover, and boundary-layer cloud cover

Named cloud layers and named cloud levels are modeled separately from pressure surfaces and height-above-ground levels. Forecast-window averages are also distinct from instantaneous values and accumulations; their exact start/end forecast hours and UTC timestamps are returned with the value.

The catalog distinguishes source units from normalized output units. If a requested variable/level combination or exact non-isobaric field is absent from a GFS file, WFG fails with the missing field rather than returning a partial result. Some interval products are not present in the analysis (`f000`) file, so asking for them at that valid time intentionally fails rather than substituting a different temporal product.

## Point query

Pressure profile:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,geopotential_height,wind \
  --levels 1000,925,850,700,500
```

Derived thermodynamics use the same pressure-profile interface:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --vars dew_point,potential_temperature,mixing_ratio,virtual_temperature,air_density,wet_bulb_temperature,equivalent_potential_temperature \
  --levels 1000,925,850,700,500 \
  --json
```

MCP uses the same variable IDs with `get_gfs_profile`; `get_gfs_points`, `get_gfs_timeseries`, and `get_gfs_points_timeseries` inherit the same derived pressure-level variables through the shared core.

Fields-only query:

```bash
wfg profile \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --fields temperature_2m,wind_10m,low_cloud_cover,low_cloud_base_pressure,precipitable_water \
  --json
```

Pressure-level variables and non-isobaric fields can be requested together in the same call by providing `--vars`, `--levels`, and `--fields`.

Non-isobaric results are records with three explicit pieces of semantics: `level`, `temporal`, and normalized `values`. For example, `total_precipitation` is returned with `temporal.type="accumulation"`, while `low_cloud_base_pressure` is returned with `temporal.type="average"`; both interval-valued products include start/end forecast hours and start/end UTC timestamps.

The run defaults to `latest`, meaning the newest GFS cycle whose already-published data can satisfy the requested valid time and exact field selection. Use `--run latest_complete` to force the newest cycle published through `f384`, or pass an explicit run timestamp for reproducibility. `wfg latest` reports the newest `f384`-complete cycle.

## Pressure-layer diagnostics

Cross-level diagnostics use two published pressure surfaces and one underlying profile fetch:

```bash
wfg layer \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --lower 850 \
  --upper 700 \
  --diagnostics temperature_lapse_rate,wind_shear,potential_temperature_gradient \
  --json
```

`lower` means lower altitude and therefore the higher pressure value; `--lower 850 --upper 700` is valid, while the reverse ordering is rejected. Layer depth is the difference in GFS geopotential height between the two surfaces.

`temperature_lapse_rate` is positive when temperature decreases with height. `wind_shear` returns upper-minus-lower U/V component changes, the vector-change magnitude, and magnitude per kilometre of geopotential-height difference. `potential_temperature_gradient` is upper-minus-lower potential temperature per kilometre. The result also includes the raw endpoint pressure-level values used by the calculations for auditability.

MCP exposes the same primitive as `get_gfs_layer_diagnostics`. The query can select either NOMADS or S3 and follows the same `latest` / `latest_complete` / explicit-run semantics as point profiles.

## Whole-profile diagnostics

Whole-profile structure is derived from an explicit set of published pressure surfaces. WFG does not silently choose vertical resolution for the caller:

```bash
wfg profile-diagnostics \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --json
```

`freezing_level_crossings` returns every 0 °C crossing found in the sampled profile. Exact sampled 0 °C levels are returned directly. Crossings between levels use linear interpolation in temperature/geopotential height and log-pressure interpolation for pressure, together with the bracketing sampled levels and warm→cold / cold→warm transition where determinable.

`temperature_inversion_layers` finds adjacent sampled segments where temperature increases with geopotential height and merges contiguous inversion segments. Each result includes base/top pressure, height and temperature, depth, total temperature increase, mean increase per kilometre, and the number of sampled segments involved.

The sampled raw levels are returned with the diagnostics for auditability. A coarse pressure-level list can therefore miss shallow structure; the tool intentionally makes that limitation visible rather than claiming continuous-profile precision.

MCP exposes the same primitive as `get_gfs_profile_diagnostics`. Both diagnostics share one minimal temperature + geopotential-height profile fetch, and the query can select NOMADS or S3.

## Parcel diagnostics

Parcel calculations require the caller to choose the parcel explicitly; WFG does not expose an ambiguous generic "CAPE" calculation:

```bash
wfg parcel \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-20T12:00:00Z \
  --levels 1000,975,950,925,900,875,850,825,800,775,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

Supported parcel definitions are:

- `surface_2m` — initializes at GFS surface pressure/geopotential height using 2 m temperature and specific humidity.
- `mixed_layer_100hpa` — pressure-weighted mean potential temperature and mixing ratio over the exact lowest 100 hPa, initialized at surface pressure.
- `most_unstable_300hpa` — sampled state with the largest Bolton equivalent potential temperature in the lowest 300 hPa.

One underlying profile request obtains pressure-level temperature, specific humidity and geopotential height together with surface pressure/geopotential height and 2 m temperature/specific humidity. The requested pressure levels therefore control environmental resolution without multiplying NOMADS requests.

The parcel ascends dry adiabatically to a Bolton lifted condensation level (LCL), then pseudo-adiabatically above it using the standard pressure-coordinate moist-lapse equation. Environmental values are interpolated in log pressure. Parcel and environmental buoyancy use virtual temperature; zero-buoyancy crossings are inserted before integrating energy. `lfc` is the first level of free convection at or above the LCL, and `el` is the first equilibrium level ending that contiguous positive-buoyancy layer. CAPE and CIN use the pressure-coordinate form `-Rd ∫ (Tv_parcel - Tv_environment) d ln(p)`.

The result returns the parcel starting state, LCL, optional LFC/EL, CAPE/CIN, the complete dry/saturated parcel path and the raw sampled environmental levels. If no LFC occurs before the profile top, CAPE is zero and CIN is integrated to the sampled top; if the positive layer continues through the sampled top, CAPE reports `profile_top` rather than inventing an equilibrium level beyond the data.

MCP exposes the same primitive as `get_gfs_parcel_diagnostics`. The query can select NOMADS or S3 and follows the same run semantics as the other point/profile diagnostics.

## Batched point query

When several locations need the same atmospheric selection at the same valid time, use one batch rather than independent point calls:

```bash
wfg points \
  --point 50.08,14.43 \
  --point 45.80,11.70 \
  --point 46.24,13.18 \
  --valid 2026-08-20T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --fields wind_10m,low_cloud_cover,cloud_ceiling \
  --json
```

MCP exposes the same primitive as `get_gfs_points`. A batch accepts up to 50 points, preserves input ordering, resolves `latest` once for the shared selection, and returns the requested/grid point plus the same normalized pressure and non-isobaric results used by the single-point surface.

Batched points are intentionally **S3-only**. The selected pressure/non-isobaric GRIB messages are downloaded once with HTTP byte ranges, then `wgrib2` samples that local slice at every requested coordinate. Local point decoding is bounded to eight concurrent operations. This avoids multiple NOMADS requests and therefore does not consume the NOMADS courtesy limiter per point.

The batch-level `source.cacheHit` is true only when the shared selected-message slice was already cached before the batch; a newly downloaded slice reports false even though subsequent points reuse it in-process.

## Point time series

```bash
wfg timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --from 2026-08-20T06:00:00Z \
  --to 2026-08-22T18:00:00Z \
  --fields temperature_2m,wind_10m,low_cloud_cover,precipitable_water \
  --json
```

Time series returns every native GFS output inside the requested range: hourly through forecast hour 120 and every three hours afterwards. It defaults to the S3 byte-range source and processes at most four forecast files concurrently. A default `maxSteps=160` guard prevents accidentally producing very large tool responses; callers can raise it up to the full 209 native GFS outputs.

With `run=latest`, time-series resolution chooses one newest eligible run initialized at or before the requested range start, verifies the exact requested fields at the first and last native forecast steps, and requires the range to fit inside the 384-hour forecast horizon. This avoids mixing model cycles inside one series while still using fresher partially published runs when they already cover the requested window.

## Multi-point time series

When several locations need the same atmospheric selection across a forecast range, combine the two batching dimensions directly rather than composing independent point time series:

```bash
wfg points-timeseries \
  --point 50.08,14.43 \
  --point 45.80,11.70 \
  --point 46.24,13.18 \
  --from 2026-08-20T06:00:00Z \
  --to 2026-08-22T18:00:00Z \
  --vars temperature,wind \
  --levels 850,700 \
  --fields temperature_2m,wind_10m,low_cloud_cover \
  --json
```

MCP exposes the same primitive as `get_gfs_points_timeseries`. The query accepts up to 20 points, resolves one model cycle for the complete time range, preserves point ordering, and returns every native GFS output inside the range.

The primitive is intentionally **S3-only**. For each forecast step WFG downloads or reuses one selected-message GRIB slice and samples all requested points from that slice. Forecast files are processed with bounded concurrency of four. The default `maxSteps=80` and `maxSamples=1600` guards bound both the temporal length and the point × step response matrix; `maxSamples` can be raised explicitly up to 5,000.

This means a three-point, five-step query performs five shared batch fetches rather than fifteen independent point fetches. The response is time-major: each series step contains its valid time, forecast hour, slice cache status, and the ordered point results for that step.

## Run-to-run comparison

```bash
wfg compare-runs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --cycles 3 \
  --vars temperature,wind \
  --levels 850,700 \
  --fields temperature_2m,low_cloud_cover \
  --json
```

MCP exposes the same primitive as `compare_gfs_runs`. It compares the same point, valid time, and atmospheric selection across 2-6 consecutive six-hour model cycles. Runs are returned oldest to newest; every transition delta is **newer minus older**.

Wind direction uses the shortest signed circular change, so 350° → 10° is +20° rather than -340°. Accumulation and forecast-window-average fields only receive numeric deltas when their absolute time windows match. See `RUN_COMPARISON.md` for the detailed contract and failure semantics.

## Bounded area summary

Pressure-level example:

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-20T12:00:00Z \
  --var temperature \
  --level 850
```

Non-isobaric example:

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-20T12:00:00Z \
  --field low_cloud_cover_average
```

MCP exposes the same primitive as `summarize_gfs_area`. It returns **min, max, and an unweighted grid-point mean** for either one raw pressure-level variable at one pressure surface or one raw non-isobaric field, one valid time, and one bbox. The raw grid is never returned to the agent.

Non-isobaric results retain exact vertical and temporal semantics. Before calculating statistics, WFG inspects the filtered GRIB inventory and requires exactly one record matching the requested variable code, GRIB level, and instantaneous/accumulation/average semantics. This prevents an instantaneous cloud-cover request from silently selecting a forecast-window-average record at the same named layer.

Derived/vector area fields remain intentionally unsupported where aggregation order matters; for example WFG does not derive an area wind from mean U/V because that is not equivalent to deriving wind at each grid cell and then aggregating. A conservative 50,000-grid-point default guard bounds the requested area. Antimeridian-crossing boxes are not supported yet. See `AREA_SUMMARY.md` for the exact record-selection, unit-normalization, and pacing behavior.

## Two data paths

NOMADS is the default for single point queries and the area-summary path because its Grib Filter can geographically subset before transfer. Surface, height-above-ground, named-layer, and named-level selections use the same Grib Filter request as pressure levels, so all physical NOMADS downloads continue to pass through the shared courtesy limiter.

For multi-point, multi-time, and run-comparison workflows, NOAA AWS Open Data is the natural path. The S3 adapter fetches the `.idx` inventory, identifies only requested pressure and non-isobaric GRIB messages, derives byte ranges, and downloads those messages with HTTP Range requests. Non-isobaric selectors match variable, exact vertical semantics, and exact temporal semantics, so an instantaneous cloud-cover request cannot silently select the forecast-window-average record at the same layer. Multi-point sampling reuses one selected-message slice across all coordinates; multi-point time series repeats that reuse once per forecast step.

Both data paths feed `wgrib2` and return normalized data with explicit provenance.

## Latest-run discovery

Query tools support three run selectors:

- `latest` — newest cycle that can satisfy the query with data already published on NOAA AWS Open Data
- `latest_complete` — newest cycle whose `f384.idx` marker exists
- an explicit 00Z/06Z/12Z/18Z initialization timestamp — reproducible fixed-cycle access

For a single valid time, query-aware discovery checks the exact forecast `.idx`, including pressure variable × level pairs and non-isobaric vertical/temporal semantics. That means an averaged cloud product absent from `f000` can cause discovery to step back to an older run where the same valid time is represented by a forecast file that actually contains the requested product.

For a time range, WFG chooses a single cycle at or before the requested start, checks exact field availability at the first and last native steps, and rejects ranges extending beyond the 384-hour horizon. Complete-run and query-specific discovery results are cached independently in-process for five minutes.

The standalone CLI `wfg latest` and MCP `get_latest_gfs_run` continue to report the newest **complete** (`f384`) cycle because they have no atmospheric query to satisfy.

## Meteorology reference validation

Deterministic meteorology has an independent golden-reference test layer in addition to WFG's implementation tests. `test/golden-meteorology.test.ts` pins published MetPy 1.7 reference cases without adding Python or MetPy to runtime/CI dependencies. It covers core thermodynamics, pseudo-adiabatic moist lapse, and a surface-parcel CAPE sounding. See `METEOROLOGY_VALIDATION.md` for the reference values, formulation differences, and tolerance policy.

The first golden validation pass exposed and corrected a saturated parcel-ascent error: the parcel path now integrates the standard pressure-coordinate moist-lapse ODE directly. The corrected path agrees with MetPy's published 925→200 hPa moist-lapse example within 0.07 °C.

## Requirements

- Node.js 20+
- `wgrib2` on `PATH` (or set `WGRIB2_PATH`)

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run test:smoke
npm run dev -- catalog
npm run dev -- latest
npm run dev -- profile --help
npm run dev -- layer --help
npm run dev -- profile-diagnostics --help
npm run dev -- parcel --help
npm run dev -- points --help
npm run dev -- timeseries --help
npm run dev -- points-timeseries --help
npm run dev -- compare-runs --help
npm run dev -- area --help
npm run mcp
```

Opt-in real upstream profile smoke tests:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

They are intentionally excluded from normal CI.

## NOMADS pacing

The default NOMADS cooldown is **11 seconds after a request completes**, deliberately conservative versus NOAA's 10-second scripted-request guidance. Cache hits do not consume the limiter. S3 access is independent of this limiter.

Default cache/state location: `~/.cache/wfg/`. Override with `WFG_CACHE_DIR`.

## Current scope

Implemented:

- discoverable pressure-level variables, pressure-layer diagnostics, whole-profile diagnostics, explicit parcel definitions, and non-isobaric field catalog
- query-aware newest-available run discovery plus explicit latest-f384-complete selection via NOAA AWS Open Data
- pressure-level point profiles with completeness validation
- deterministic per-level wet-bulb and equivalent-potential-temperature derivations in addition to the existing dry/moist thermodynamic variables
- deterministic pressure-layer temperature lapse rate, vector wind shear, and potential-temperature gradient from one shared endpoint profile
- deterministic whole-profile freezing-level crossings and sampled inversion layers from one explicit sampled profile
- explicit surface, 100 hPa mixed-layer, and sampled 300 hPa most-unstable parcel diagnostics with Bolton LCL, dry/pseudo-adiabatic path, first LFC/EL, CAPE and CIN
- independent MetPy-based golden-reference validation for core thermodynamics, moist lapse, and CAPE
- batched same-time sampling for up to 50 points with one reusable S3 selected-message slice
- native-cadence multi-point time series for up to 20 points with one reusable S3 selected-message slice per forecast step and point-step guards
- run-to-run comparison across 2-6 consecutive GFS cycles with raw snapshots, deterministic deltas, and interval comparability rules
- surface and height-above-ground point fields with exact-level validation
- named cloud layers/levels and whole-atmosphere column products with exact vertical semantics
- accumulation and forecast-window-average fields with explicit forecast intervals
- native-cadence point time series with bounded concurrency and step guard
- bounded raw pressure-level and raw non-isobaric area min/max/unweighted mean without returning grids
- exact non-isobaric area GRIB-message selection by variable, vertical semantics, and temporal semantics
- 12 raw pressure-level fields plus 8 deterministic derived pressure-level variables
- surface diagnostics plus 2/10/20/30/40/50/80/100 m fields and derived winds
- instantaneous and averaged cloud-cover layers, cloud boundaries/top temperatures, cloud ceiling, precipitable/cloud water, ozone, and cloud work function
- deterministic NOMADS geographic-subset path with 11 s cross-process limiter
- NOAA AWS `.idx` + selected-message byte-range path with reusable subset cache
- `wgrib2` point extraction for isobaric/non-isobaric named-layer and temporal semantics plus exact-message area statistics adapters
- CLI `catalog`, `latest`, `profile`, `layer`, `profile-diagnostics`, `parcel`, `points`, `timeseries`, `points-timeseries`, `compare-runs`, and `area`
- MCP `get_gfs_catalog`, `get_latest_gfs_run`, `get_gfs_profile`, `get_gfs_layer_diagnostics`, `get_gfs_profile_diagnostics`, `get_gfs_parcel_diagnostics`, `get_gfs_points`, `get_gfs_timeseries`, `get_gfs_points_timeseries`, `compare_gfs_runs`, and `summarize_gfs_area`
- shared CLI/MCP result contracts and comprehensive deterministic offline test suite plus opt-in real NOAA profile smoke tests

Next:

1. improve catalog search/filter ergonomics as the field surface grows
2. add a pressure-level transect/cross-section primitive
3. extend area summaries with optional extrema locations, percentiles, and threshold fractions
4. add parcel/profile-diagnostic time-series composition if repeated structure analysis proves useful
5. add live multi-point/time-series/parcel/non-isobaric-area smoke coverage after the paths have been exercised manually
