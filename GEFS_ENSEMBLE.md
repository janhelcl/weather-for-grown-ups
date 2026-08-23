# GEFS point ensemble

WFG's first ensemble surface exposes the NOAA Global Ensemble Forecast System (GEFS) as a model-native uncertainty primitive rather than converting member spread into a hidden confidence score.

## Scope

The initial surface is intentionally narrow:

- model: operational GEFS atmospheric `pgrb2a` 0.5° product;
- members: control `c00` plus perturbed `p01` through `p30`;
- one point and one valid time per query;
- native three-hour forecast cadence from `f000` through `f384` in the current WFG contract;
- one raw pressure-level variable and one pressure surface per query;
- NOAA AWS Open Data `.idx` byte-range access only;
- normalized member values plus deterministic ensemble distribution summaries.

This is the base primitive for later ensemble time series, probabilities, diagnostics, and deterministic-GFS outlier comparisons. Those higher-level compositions are not hidden inside this first endpoint.

## Supported pressure-level variables

WFG validates against the GEFS `pgrb2a` inventory before network access instead of reusing the broader deterministic GFS 0.25° catalog.

Common supported pressure levels are `10,50,100,200,250,500,700,850,925,1000` hPa for:

- `temperature`;
- `relative_humidity`;
- `u_wind`;
- `v_wind`;
- `geopotential_height`.

`u_wind` and `v_wind` additionally support `300` and `400` hPa in this first contract.

Unsupported variable/level combinations fail validation rather than being silently substituted.

## CLI

```bash
wfg ensemble \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --quantiles 0.1,0.5,0.9 \
  --gte 10 \
  --json
```

By default all 31 members are sampled. A subset can be requested explicitly:

```bash
wfg ensemble \
  --lat 50.08 \
  --lon 14.43 \
  --run 2026-08-24T00:00:00Z \
  --valid 2026-08-24T12:00:00Z \
  --var geopotential_height \
  --level 500 \
  --members c00,p01,p02,p03,p04 \
  --json
```

## MCP

The equivalent MCP tool is `get_gefs_ensemble`. CLI and MCP call the same `GefsEnsembleService` and validate against the same public schema.

## Result semantics

The result preserves:

- explicit GEFS model identity (`gefs_0p50`);
- initialization time, valid time, and forecast hour;
- requested coordinate and actual sampled model grid point;
- selected raw variable, GRIB code, pressure surface, normalized output field, and unit;
- every requested member's normalized value and cache-hit state;
- arithmetic mean;
- population standard deviation across the requested members;
- minimum and maximum;
- caller-selected quantiles using deterministic linear interpolation between sorted member values;
- optional count and fraction of requested members greater than or equal to a threshold.

### Threshold fractions are not calibrated probabilities

If 20 of 31 requested members exceed a threshold, WFG reports `20 / 31`. It explicitly labels that value `raw_member_fraction_not_calibrated_probability`.

This is useful evidence about ensemble behavior, but WFG does not claim that a 20/31 member fraction means a calibrated 64.5% real-world probability. Calibration, model weighting, climatological correction, and decision-specific interpretation belong in higher layers.

## Run selection

`run="latest"` is query-aware. WFG starts from the newest six-hour GEFS cycle that could precede the requested valid time and walks backward until the requested member files exist at the required native forecast hour. All selected members must be available from the same initialization cycle.

An explicit `00Z`, `06Z`, `12Z`, or `18Z` initialization timestamp is supported for reproducibility.

The current ensemble contract deliberately stops at `f384`, even where upstream GEFS products may offer longer horizons. Extending the horizon should be an explicit model-contract change with tests rather than an accidental side effect of upstream availability.

## Data access and caching

GEFS uses NOAA AWS Open Data directly:

1. resolve the member-specific immutable `pgrb2a` object;
2. fetch and cache its `.idx` inventory;
3. select only the byte range for the requested GRIB variable and pressure surface;
4. cache the immutable selected-message subset;
5. sample the requested point locally with `wgrib2`;
6. aggregate normalized values across members locally.

The cache lives under `~/.cache/wfg/gefs-s3` by default, or beneath `WFG_CACHE_DIR` when configured.

Unlike NOMADS access, this path does not use the 11-second NOMADS courtesy limiter because it reads public AWS Open Data objects and byte ranges rather than scripted NOMADS filter requests.

## Deliberate non-goals of this first slice

Not yet included:

- GEFS time series;
- ensemble profiles containing many variables/levels at once;
- ensemble parcel/layer/profile diagnostics;
- threshold probabilities across time or areas;
- calibrated probabilities;
- comparison of deterministic GFS against the GEFS distribution;
- ensemble-derived activity suitability or safety judgments.

Those should compose from this model/member/source contract rather than bypass it.
