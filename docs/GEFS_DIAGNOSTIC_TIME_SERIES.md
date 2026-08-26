# GEFS diagnostic time series

WFG composes member-first GEFS diagnostic services across native three-hour forecast outputs from one fixed initialization cycle.

The rule is:

> derive meteorology per member first, summarize across members second, compose those summaries through time third.

No new meteorological formulas live in the time-series composer.

## Supported diagnostic families in v0.1.0

The GEFS core supports all three diagnostic families:

- `layer`
  - environmental temperature lapse rate
  - vector wind shear
  - potential-temperature gradient
- `profile`
  - freezing-level crossings
  - sampled temperature-inversion layers
- `parcel`
  - explicit `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa` parcel
  - LCL / LFC / EL
  - CAPE / CIN

Parcel diagnostics were added before v0.1.0; older documentation that described them as unavailable is obsolete.

## CLI surface

The CLI currently exposes the same core through two command shapes.

Layer and profile series use the shared model-selectable command:

```bash
wfg diagnostic-timeseries \
  --model gefs \
  --kind profile \
  --lat 50.08 --lon 14.43 \
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
  --lat 50.08 --lon 14.43 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --lower 850 --upper 500 \
  --diagnostics temperature_lapse_rate,wind_shear \
  --json
```

Parcel series use the explicit model-native command:

```bash
wfg ensemble-parcel-timeseries \
  --lat 45.80 --lon 11.77 \
  --start 2026-08-24T06:00:00Z \
  --end 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500,250,200 \
  --parcel surface_2m \
  --quantiles 0.1,0.5,0.9 \
  --json
```

This is a CLI registration distinction, not a different meteorological implementation. `diagnostic-timeseries --model gefs --kind parcel` is not accepted in v0.1.0; use `ensemble-parcel-timeseries`.

## MCP surface

MCP exposes one GEFS-specific tool:

- `get_gefs_diagnostic_timeseries`

Its schema supports `layer`, `profile`, and `parcel`. MCP therefore does not share the CLI's parcel command split.

## Fixed-run semantics

One request fixes:

- geographic point;
- GEFS initialization cycle;
- member selection;
- quantile selection;
- diagnostic family and parameters;
- explicit pressure layer/profile sampling;
- inclusive valid-time range.

`run="latest"` resolves one cycle capable of covering the **complete requested range** for all selected members. Every step then receives that explicit run, so a series cannot drift to a newer model cycle while it is being evaluated.

Bounds must lie on native three-hour valid times and remain inside the current `f000`–`f384` WFG contract.

## Member-first computation

At each valid step, WFG calls the corresponding single-time member-first service:

```text
fixed GEFS step
    ↓
selected members
    ↓
member atmospheric state / parcel dependencies
    ↓
shared diagnostic physics per member
    ↓
ensemble summary for the step
```

Layer depth is member-specific. Freezing/inversion structures are found independently inside every member. Parcel paths and buoyancy are calculated independently for every member before CAPE/CIN and boundary distributions are summarized.

## Compact output by design

Time series return compact ensemble summaries at each forecast step rather than repeating every member's full sounding, parcel path, freezing crossings, or inversion layers.

Use the corresponding single-time tools for audit detail:

- `get_gefs_layer_diagnostics`
- `get_gefs_profile_diagnostics`
- `get_gefs_parcel_diagnostics`

This keeps a series useful in an agent context without throwing away member-first physical semantics.

## Probability semantics

Any member event/boundary fractions remain raw ensemble evidence. For example, the fraction of members with an LFC or a freezing crossing is **not** promoted to a calibrated real-world probability merely because it is plotted through time.
