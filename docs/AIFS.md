# ECMWF AIFS

WFG exposes ECMWF **AIFS Single** as the public dataset `aifs`.

AIFS is deliberately not presented as “IFS with an AI flag”. It shares the unified atmospheric query language with the other datasets, while keeping its own upstream run, cadence, inventory and provenance semantics.

## Public identity

- public dataset: `aifs`
- internal dataset: `aifs_0p25`
- provider: ECMWF
- model class: AI
- kind: deterministic forecast
- Open Data model path: `aifs-single`
- horizontal grid: 0.25°
- cycles: 00, 06, 12 and 18 UTC
- native output cadence: 6 hours
- maximum forecast lead: f360

`forecast.run` supports `latest` or an explicit 00/06/12/18 UTC initialization. Selection-aware latest-run discovery checks that the requested AIFS fields are actually present before choosing a cycle.

## Pressure-level inventory

AIFS Open Data pressure levels exposed by WFG:

`1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 hPa`

Native pressure variables (all use the listed pressure-level vocabulary except specific humidity, which is available through 50 hPa but not 10 hPa in AIFS Single v2):

- `temperature` ← ECMWF `t`
- `u_wind` ← `u`
- `v_wind` ← `v`
- `geopotential_height` ← `z`, normalized from geopotential using standard gravity
- `specific_humidity` ← `q`
- `vertical_velocity` ← `w`

Shared canonical diagnostics additionally expose derived wind, potential temperature, mixing ratio, virtual temperature, air density, wet-bulb temperature and equivalent potential temperature where their dependencies are available.

AIFS does **not** pretend to publish the IFS pressure-level relative-humidity, vorticity or divergence inventory. Requests for unsupported variables fail in schema validation before data access.

## Surface fields

The current WFG slice exposes:

- surface pressure and surface geopotential height
- 2 m temperature and dew point
- derived 2 m relative and specific humidity
- 10 m and 100 m wind components plus derived speed/direction
- mean sea-level pressure
- total precipitation
- low, middle, high and total cloud cover

Units are normalized to the same canonical outputs used elsewhere in WFG: temperatures to °C, geopotential to geopotential metres, precipitation to mm and cloud fractions to percent.

## Operations

The unified query surface supports:

- point profiles
- point time series
- multi-point queries
- multi-point time series
- great-circle transects
- bounded area summaries and distributions
- layer diagnostics
- structural profile diagnostics
- diagnostic time series

Parcel diagnostics are intentionally not advertised in this first AIFS slice. That boundary is explicit in the capability catalog rather than silently falling back to another model or inventing missing symmetry.

## Access and caching

AIFS uses the ECMWF Open Data mirrors and the same provider-level retry/access-policy machinery as IFS. WFG reads ECMWF JSON-line indexes, downloads only the requested GRIB message byte ranges, concatenates the selected immutable messages into a local subset and decodes them with the bundled GRIB decoder.

AIFS has a separate cache namespace and cache identity from IFS even though both are delivered by ECMWF Open Data.

## Example

```bash
wfg query \
  --dataset aifs \
  --lat 50.08 --lon 14.43 \
  --at 2026-09-01T12:00:00Z \
  --variables temperature,wind,geopotential_height \
  --levels 850,700,500 \
  --fields temperature_2m,wind_10m,mean_sea_level_pressure \
  --json
```

The same request is available through MCP `query_atmosphere` with `dataset: "aifs"`.
