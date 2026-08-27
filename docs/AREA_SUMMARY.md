# Bounded-area summaries

WFG exposes bounded geographic statistics through `query` / `query_atmosphere` using area geometry. The same public shape works for deterministic GFS, member-first GEFS, and historical GFS analysis where supported.

This page focuses on deterministic GFS semantics.

## Basic result

A basic request returns:

- number of defined GFS grid cells;
- minimum;
- maximum;
- **unweighted grid-point mean**.

The default request guard is 50,000 estimated 0.25° grid points. WFG returns aggregates, not the raw grid.

### Pressure-level variable

```bash
wfg query \
  --dataset gfs \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --json
```

The deterministic GFS area implementation accepts exactly one raw pressure-level variable on one published pressure surface.

### Non-isobaric field

```bash
wfg query \
  --dataset gfs \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --at 2026-08-24T12:00:00Z \
  --fields low_cloud_cover_average \
  --json
```

A field request preserves its public vertical and temporal semantics. Accumulations and forecast-window averages retain their forecast interval.

## Exact GRIB-message selection

A geographically filtered GRIB file can still contain more than one temporal product for the same code and level. WFG therefore selects by complete declared semantics: variable code, exact vertical level, and temporal type. Missing or ambiguous matches fail explicitly.

## Unit normalization

Statistics are converted to the catalog's public output unit. Source temperatures in kelvin, for example, are exposed in degrees Celsius.

## Derived wind is deliberately absent

Derived vector wind fields such as `wind_10m` are not accepted by the deterministic GFS area implementation. Averaging U and V first is not equivalent to deriving wind at every cell and then aggregating; WFG fails instead of returning the wrong quantity.

## Rich distributions

Percentiles, threshold fractions and extrema locations are optional extensions of the same `query_atmosphere` area request. See [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md).

## Data access and pacing

Deterministic GFS area summaries use NOAA NOMADS so the region can be cropped before transfer. Physical downloads use the normal cache and shared cross-process courtesy limiter.

The reported mean is an unweighted model-grid-point mean, not an area-weighted spherical mean.
