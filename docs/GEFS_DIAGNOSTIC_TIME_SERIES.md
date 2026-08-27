# GEFS diagnostic time series

GEFS diagnostic time series use the same public `diagnose` / `diagnose_atmosphere` operation as the other datasets, with `dataset=gefs` and a time range.

The physical rule remains:

> derive meteorology per member first, summarize across members second, compose those summaries through time third.

## Supported families

GEFS supports `layer`, `profile`, and `parcel` diagnostics. Parcel definitions are `surface_2m`, `mixed_layer_100hpa`, and `most_unstable_300hpa`.

## CLI

Profile series:

```bash
wfg diagnose \
  --dataset gefs \
  --kind profile \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500 \
  --diagnostics freezing_level_crossings,temperature_inversion_layers \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Parcel series:

```bash
wfg diagnose \
  --dataset gefs \
  --kind parcel \
  --lat 45.80 --lon 11.77 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --levels 1000,925,850,700,500,250,200 \
  --parcel surface_2m \
  --quantiles 0.1,0.5,0.9 \
  --json
```

There is no separate ensemble parcel/time-series public command.

## MCP

Tool: `diagnose_atmosphere`. Its diagnostic discriminated union covers all three GEFS families.

## Fixed-run semantics

One request fixes the point, initialization cycle, member set, quantiles, diagnostic selection and inclusive valid-time range. `run=latest` resolves one cycle capable of covering the complete requested range.

## Member-first computation

At every valid step, WFG builds each selected member's atmospheric state, runs the shared physical calculation independently, and only then summarizes the member results.

Layer depth is member-specific. Freezing/inversion structures and parcel buoyancy are evaluated inside each member before aggregation.

## Compact output

Time series return compact ensemble summaries rather than repeating every member's full sounding or parcel path. Request one instant with the same `diagnose_atmosphere` tool when member-level audit detail is needed.

Any event fractions remain raw ensemble evidence, not calibrated real-world probability.
