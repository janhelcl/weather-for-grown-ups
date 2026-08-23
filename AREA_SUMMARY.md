# Bounded area summaries

WFG exposes bounded geographic statistics without returning the raw GFS grid to the agent. The same primitive is available as CLI `wfg area` and MCP `summarize_gfs_area`.

The result contains the number of defined grid cells plus minimum, maximum, and an **unweighted GFS grid-point mean**. The default request guard is 50,000 estimated 0.25° grid points.

## Pressure-level field

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --json
```

Pressure summaries accept one raw pressure-level variable and one published GFS pressure surface. Derived pressure variables are intentionally not accepted by the area primitive yet.

## Non-isobaric field

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --field low_cloud_cover_average \
  --json
```

A field request accepts one **raw** non-isobaric catalog field. This includes surface, height-above-ground, named-layer, named-level, column, instantaneous, accumulation, and forecast-window-average products.

The result includes:

- the catalog field ID
- exact public vertical semantics (`surface`, height AGL, named layer, or named level)
- exact temporal semantics
- normalized output field name and unit
- bounded-area statistics

For accumulation and average products, temporal metadata includes the GFS forecast-hour interval and absolute UTC start/end times.

## Exact GRIB-record selection

NOMADS Grib Filter selects variables and vertical levels, but one filtered response can still contain more than one temporal product for the same code and level. For example, low cloud cover can have both an instantaneous record and a forecast-window-average record.

WFG therefore does not run statistics blindly over the filtered file. For non-isobaric area requests it first inspects the local `wgrib2 -s` inventory and requires exactly one record matching:

1. GFS variable code
2. exact GRIB vertical level text
3. temporal semantics: instantaneous, accumulation, or average

Only that record is passed to `wgrib2 -stats`. Missing and ambiguous matches fail explicitly.

This is the same fail-closed philosophy used by point/profile field extraction: an instantaneous request must never silently become an average request simply because both share a variable code and named layer.

## Unit normalization

Statistics are normalized to the field catalog's public output unit after aggregation.

Temperature records published in kelvin and exposed by WFG in degrees Celsius are shifted by 273.15 for mean/min/max. Numerically equivalent conversions such as precipitation `kg/m²` to liquid-water-equivalent `mm` preserve the numeric values.

## Why derived wind is not supported yet

Derived `wind_10m`, `wind_20m`, and similar fields are intentionally rejected for area summaries.

Computing an area mean U and mean V and then deriving wind speed/direction is **not** equivalent to deriving wind at every grid cell and then aggregating those derived values. The latter requires a grid-aware derived-statistics path rather than the scalar `wgrib2 -stats` adapter used here.

Until that path exists, WFG fails rather than returning a mathematically misleading area wind statistic.

## Data access and pacing

Area summaries use NOAA NOMADS because Grib Filter can crop the geographic region before transfer. Every physical download uses the same `NomadsCache` and cross-process `FileRateLimiter` as other NOMADS access.

The default cooldown remains **11 seconds after a request completes**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. Cache hits do not consume a limiter slot.

## Geographic limits

Current area constraints:

- bbox coordinates must be within normal latitude/longitude bounds
- west must be strictly less than east
- south must be strictly less than north
- antimeridian-crossing boxes are not supported yet
- the default estimated-grid guard is 50,000 cells, raiseable explicitly within the schema maximum

The mean is an unweighted grid-point mean, not an area-weighted spherical mean.
