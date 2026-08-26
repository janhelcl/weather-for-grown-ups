# GEFS mixed field bundles

WFG can query a heterogeneous set of NOAA GEFS 0.5° `pgrb2a` fields in one ensemble operation. This surface is intended for agent workflows that need a coherent weather state rather than one scalar at a time.

## Why this is a separate primitive

A request can combine, for example:

- pressure-level temperature, humidity, wind or geopotential height;
- member-first derived pressure thermodynamics;
- 2 m temperature and relative humidity;
- 10 m wind;
- precipitation;
- precipitable water;
- total atmospheric cloud cover;
- published 180–0 hPa AGL CAPE/CIN;
- mean sea-level pressure.

WFG expands raw dependencies, creates one canonical mixed selection, fetches one selected GRIB slice per ensemble member, derives supported quantities **inside each member**, then aggregates across members.

For one point/time, upstream selected-file work therefore scales with members rather than `members × requested outputs`. Multi-point operations reuse the same selected member files across coordinates; time-series operations repeat that pattern across native three-hour steps from one fixed cycle.

## Public surfaces

### CLI

Single point, single time:

```bash
wfg ensemble-fields \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T15:00:00Z \
  --vars temperature,dew_point \
  --levels 850,700 \
  --fields temperature_2m,relative_humidity_2m,wind_10m,total_precipitation,total_atmosphere_cloud_cover,cape_180mb \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Single point, time series:

```bash
wfg ensemble-fields-timeseries \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T15:00:00Z \
  --to 2026-08-25T15:00:00Z \
  --vars temperature,equivalent_potential_temperature \
  --levels 850,700 \
  --fields temperature_2m,wind_10m,total_precipitation,precipitable_water,total_atmosphere_cloud_cover \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Multiple points, single time:

```bash
wfg ensemble-fields-points \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --valid 2026-08-24T15:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m,total_precipitation \
  --json
```

Multiple points, time series:

```bash
wfg ensemble-fields-points-timeseries \
  --point 50.08,14.43 \
  --point 49.20,16.61 \
  --point 47.81,13.06 \
  --from 2026-08-24T15:00:00Z \
  --to 2026-08-25T15:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m,total_precipitation \
  --max-point-steps 800 \
  --json
```

`--include-members` is optional. Time and point×time surfaces enforce response guardrails before run resolution or upstream access.

### MCP

- `get_gefs_fields` — one mixed selection at one point/time.
- `get_gefs_fields_timeseries` — one mixed selection across native three-hour valid times from one fixed cycle.
- `get_gefs_fields_points` — one mixed selection across up to 20 points with one selected file per member.
- `get_gefs_fields_points_timeseries` — one mixed selection across up to 20 points and native three-hour valid times from one fixed cycle.

Both MCP transports expose the same tools.

## Pressure-level variables

Native pressure variables are model/product-specific and include temperature, relative humidity, U/V wind, geopotential height, and explicitly supported vertical velocity.

The current member-first derived pressure variables are:

- `dew_point`
- `potential_temperature`
- `specific_humidity`
- `mixing_ratio`
- `virtual_temperature`
- `air_density`
- `wet_bulb_temperature`
- `equivalent_potential_temperature`

Every derived quantity expands to its raw GEFS dependencies and is calculated independently for each member before ensemble aggregation. Availability is still checked at each requested pressure level.

## Non-isobaric fields

The v0.1.0 GEFS field catalog includes:

- `surface_pressure`
- `temperature_2m`
- `relative_humidity_2m`
- `u_wind_10m`
- `v_wind_10m`
- derived `wind_10m`
- `total_precipitation`
- `precipitable_water`
- `total_atmosphere_cloud_cover`
- `cape_180mb`
- `cin_180mb`
- `mean_sea_level_pressure`

The catalog is intentionally tied to the supported `pgrb2a` product. It does not imply support for another GEFS product or for fields not declared in the catalog.

## Temporal semantics

Field time semantics remain explicit:

- instantaneous fields stay instantaneous;
- precipitation carries its decoded accumulation forecast-hour window and absolute interval;
- total cloud cover carries its decoded average interval and absolute interval.

A bundle at one valid time can therefore contain values representing different temporal intervals. Consumers should use each field's `temporal` metadata rather than treating everything as an instantaneous observation.

## Wind direction

Wind speed is summarized numerically. Direction is circular data, so WFG returns a circular mean direction and resultant length instead of applying ordinary scalar averaging/quantiles to degrees.

## Composition and caching

Mixed selections merge raw dependencies into one selected member file. Multi-point operations reuse that file across every requested coordinate, while time-series operations fix one cycle and repeat the single-time primitive across native forecast steps.

Local extraction/decoding still has point-level work, but the upstream object transfer is deliberately reused rather than multiplied by point count. The normal npm decoder is bundled; native `wgrib2` is an optional backend and is not part of the bundle semantics.

## Ensemble semantics

Bundle summaries contain raw model-member distributions. They are not calibrated real-world probabilities or generic uncertainty scores. Omitting member arrays changes response size, not the member-first computation that produced the summaries.
