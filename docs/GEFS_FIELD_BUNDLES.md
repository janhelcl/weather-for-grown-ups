# GEFS mixed field bundles

GEFS mixed field bundles are a capability of the normal `query` / `query_atmosphere` operation with `dataset=gefs`. There is no separate public bundle API.

A single selection can combine pressure-level variables and supported non-isobaric fields. WFG expands raw dependencies, creates one canonical selection, fetches one selected GRIB slice per member, derives supported quantities **inside each member**, then aggregates across members.

## Examples

Single point, single time:

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T15:00:00Z \
  --vars temperature,dew_point \
  --levels 850,700 \
  --fields temperature_2m,relative_humidity_2m,wind_10m,total_precipitation,total_atmosphere_cloud_cover,cape_180mb \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The same operation handles a time range:

```bash
wfg query \
  --dataset gefs \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T15:00:00Z \
  --to 2026-08-25T15:00:00Z \
  --vars temperature,equivalent_potential_temperature \
  --levels 850,700 \
  --fields temperature_2m,wind_10m,total_precipitation,precipitable_water,total_atmosphere_cloud_cover \
  --quantiles 0.1,0.5,0.9 \
  --json
```

and multiple points:

```bash
wfg query \
  --dataset gefs \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --at 2026-08-24T15:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m,total_precipitation \
  --json
```

MCP uses `query_atmosphere` with the equivalent point/points geometry and instant/range time shape.

## Pressure-level variables

Native variables include temperature, relative humidity, U/V wind, geopotential height, and explicitly supported vertical velocity. Member-first derived variables include dew point, potential temperature, specific humidity, mixing ratio, virtual temperature, air density, wet-bulb temperature, and equivalent potential temperature.

Derived quantities expand to raw dependencies and are calculated independently for every member before aggregation.

## Non-isobaric fields

The supported GEFS `pgrb2a` catalog includes surface pressure, 2 m thermodynamics, 10 m wind, precipitation, precipitable water, total atmospheric cloud cover, CAPE/CIN and mean sea-level pressure.

Use `search_catalog` with `datasets=["gefs"]` to discover the current exact vocabulary.

## Temporal and ensemble semantics

Instantaneous, accumulation, and average intervals remain explicit per field. A mixed bundle at one valid time may therefore contain fields representing different temporal windows.

Wind direction is aggregated circularly. All other numeric ensemble summaries remain member-first distributions. They are raw model-member evidence, not calibrated probability.
