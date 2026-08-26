# Deterministic GFS bounded-area summaries

WFG exposes bounded geographic statistics without returning a raw GFS grid to the agent. The deterministic surface is available through CLI `wfg area --model gfs` (GFS is the default) and MCP `summarize_gfs_area`.

GEFS has a separate member-first area implementation behind the same CLI operation with `--model gefs` and MCP `get_gefs_area_summary`; see [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md). This document describes the deterministic GFS semantics.

## Basic result

A basic request returns:

- number of defined GFS grid cells;
- minimum;
- maximum;
- **unweighted grid-point mean**.

The default request guard is 50,000 estimated 0.25° grid points. WFG returns aggregates, not the grid itself.

### Pressure-level variable

```bash
wfg area \
  --model gfs \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --json
```

The deterministic GFS area primitive accepts one **raw** pressure-level variable on one published pressure surface. Derived pressure variables are rejected rather than approximated from area means.

### Non-isobaric field

```bash
wfg area \
  --model gfs \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --field low_cloud_cover_average \
  --json
```

A field request accepts one raw non-isobaric catalog field and preserves its public vertical and temporal semantics. Accumulations and forecast-window averages include their forecast-hour interval and absolute UTC start/end times.

## Exact GRIB-message selection

A geographically filtered GRIB file can still contain more than one temporal product for the same variable code and level. WFG therefore selects the local message by the complete declared semantics:

1. variable code;
2. exact GRIB vertical level;
3. temporal type: instantaneous, accumulation, or average.

Missing or ambiguous matches fail explicitly. An instantaneous request never silently becomes a forecast-window average simply because both use the same source variable code.

Message selection and statistics go through WFG's decoder abstraction. The normal npm path uses the bundled GRIB2 decoder; native `wgrib2` remains an optional compatibility/debug backend. Decoder choice does not change the public area contract.

## Unit normalization

Statistics are converted to the catalog's public output unit. For example, source temperatures in kelvin are exposed in degrees Celsius; numerically equivalent precipitation conversion from `kg/m²` to liquid-water-equivalent `mm` preserves values.

## Derived wind is deliberately absent

Derived vector wind fields such as `wind_10m` are not accepted by the deterministic GFS area primitive.

Averaging U and V across an area and deriving speed/direction afterward is not equivalent to deriving vector wind at every grid cell and then aggregating those derived values. WFG fails instead of returning the former as though it represented the latter.

## Rich distributions

Percentiles, threshold fractions and extrema locations are available as opt-in extensions of the same bounded request. They materialize only the geographically bounded values inside the local calculation and still do not return the grid.

See [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md).

## Data access and pacing

Deterministic GFS area summaries use NOAA NOMADS because Grib Filter can crop the region before transfer. Physical downloads use the normal `NomadsCache` and shared cross-process courtesy limiter.

The default cooldown is **11 seconds after a request completes**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. Cache hits do not consume a limiter slot.

## Geographic limits

Current deterministic area constraints include:

- latitude/longitude bounds must be valid;
- west must be strictly less than east;
- south must be strictly less than north;
- antimeridian-crossing boxes are not supported;
- the estimated-grid guard applies before network access.

The reported mean is an unweighted model-grid-point mean, not an area-weighted spherical mean.
