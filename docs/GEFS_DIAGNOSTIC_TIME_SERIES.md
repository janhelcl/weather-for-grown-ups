# GEFS diagnostic time series

WFG composes the existing single-time GEFS diagnostic services across native three-hour forecast outputs from one fixed GEFS initialization cycle.

The core rule remains:

> derive meteorology per member first, summarize across members second, compose those summaries through time third.

No new meteorological formulas live in the time-series service.

## Supported diagnostic families

The current GEFS diagnostic time-series surface supports:

- `layer`
  - `temperature_lapse_rate`
  - `wind_shear`
  - `potential_temperature_gradient`
- `profile`
  - `freezing_level_crossings`
  - `temperature_inversion_layers`

GEFS parcel/CAPE/CIN diagnostics are not supported because the current GEFS contract does not expose the complete surface/non-isobaric parcel inputs required for parity with deterministic GFS. Requests do not silently substitute a different parcel definition.

## Fixed-run semantics

One query fixes:

- geographic point;
- GEFS initialization cycle;
- member selection;
- quantile selection;
- diagnostic family and IDs;
- pressure layer or explicit pressure-profile levels;
- inclusive valid-time range.

`run="latest"` resolves the newest GEFS cycle that can cover the **complete requested range** for all selected members. The resolved run is then passed explicitly to every single-time diagnostic step, so a series cannot drift between model cycles while it is being evaluated.

Both range bounds must be exact native three-hour valid times. The current hard horizon remains `f000` through `f384`.

## Compact output by design

Diagnostic time series deliberately return **ensemble summaries only** at each step.

They do not repeat full member profiles, memberwise layer endpoints, freezing crossings, or inversion structures across every time step. Those payloads scale as `members × steps × variable-length structures` and are a poor default for an agent context.

Use the single-time tools when an interesting forecast step needs audit detail:

- `get_gefs_layer_diagnostics`
- `get_gefs_profile_diagnostics`

This makes the time series a discovery/comparison surface and the single-time tools the detailed audit path.

## Layer-series step

Every layer step contains:

- valid time and forecast hour;
- fixed pressure-layer identity;
- member-specific layer-depth distribution;
- one distribution summary per requested diagnostic output;
- whether every underlying member slice for that step was a cache hit.

Each diagnostic at each step was computed independently for every member before mean/spread/quantiles were calculated.

## Profile-series step

Every whole-profile step contains:

- valid time and forecast hour;
- sampled pressure levels;
- the same structural ensemble summaries as the single-time profile-diagnostic service;
- whether every underlying member slice for that step was a cache hit.

For freezing levels this includes raw member event fraction, crossing-count distribution, and conditional crossing-height/pressure summaries where crossings exist.

For inversions this includes raw member event fraction, layer-count and total-depth distributions, plus conditional strongest/deepest-layer summaries where inversions exist.

No absent structure is converted into a fake height, pressure, or layer strength.

## CLI

The canonical command is model-selectable:

```bash
wfg diagnostic-timeseries \
  --model gefs \
  --kind profile \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Layer example:

```bash
wfg diagnostic-timeseries \
  --model gefs \
  --kind layer \
  --lat 50.08 \
  --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --lower 850 \
  --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear \
  --json
```

GFS remains the default when `--model` is omitted and retains support for `layer`, `profile`, and `parcel` diagnostic time series.

GEFS defaults to a `maxSteps` guard of 40. Callers can raise it up to the native hard maximum when a larger response is intentional.

## MCP

Use:

- `get_gefs_diagnostic_timeseries`

The MCP schema is explicit to GEFS rather than exposing a very large cross-model polymorphic tool. The underlying CLI and MCP still share the same core service and result schema.

## Upstream concurrency and caching

Forecast steps are processed with bounded concurrency. Each step delegates to a single-time GEFS diagnostic service, which in turn uses bounded member concurrency. Within one member, selected byte ranges are downloaded sequentially and stitched into one immutable cached multi-message GRIB slice.

The series-level `source.allCacheHit` is true only when every underlying step reports all member slices as cache hits.

## Probability semantics

Any member fractions contained inside profile diagnostic summaries remain explicitly tagged:

`raw_member_fraction_not_calibrated_probability`

The time dimension does not change their interpretation. WFG does not convert member fractions into calibrated event probabilities or infer temporal event probability from adjacent steps.
