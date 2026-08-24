# GEFS mixed field bundles

WFG can query a heterogeneous set of NOAA GEFS 0.5° `pgrb2a` fields in one ensemble operation. This surface exists for agent workflows that need a coherent weather state rather than one scalar field at a time.

## Why this is a separate primitive

A request such as:

- 850 hPa temperature and dew point;
- 2 m temperature and relative humidity;
- 10 m wind;
- precipitation;
- precipitable water;
- total cloud cover;
- CAPE/CIN;
- mean sea-level pressure;

should not require one NOAA selected-message request per logical output. WFG expands raw dependencies, builds one canonical mixed selection, fetches one selected GRIB slice per ensemble member, derives supported quantities member-by-member, and only then aggregates across the ensemble.

For one point and one forecast step, upstream/decode work therefore scales approximately with **members**, not **members × requested fields**.

For multiple points, WFG reuses each member's selected file across all coordinates. Upstream fetches still scale with **members**, while the current point-oriented `wgrib2` adapter performs local decodes at **members × points**.

For multiple points over time, one GEFS cycle is fixed for the full range and the multi-point primitive is called once per native three-hour step. Upstream selected-file work scales with **steps × members**; local point extraction scales with **steps × members × points**.

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
  --vars temperature,dew_point \
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

`--include-members` is optional. Time and point×time surfaces are protected by response guardrails before run resolution or upstream access. The point×time operation bounds both `points × steps` and, when member payloads are requested, `points × steps × members × scalar outputs`.

### MCP

- `get_gefs_fields` — one mixed selection at one point/time.
- `get_gefs_fields_timeseries` — one mixed selection across native three-hour valid times from one fixed model cycle.
- `get_gefs_fields_points` — one mixed selection across up to 20 points with one selected file per member.
- `get_gefs_fields_points_timeseries` — one mixed selection across up to 20 points and native three-hour valid times from one fixed model cycle.

Both MCP transports use the same extended server factory, so stdio and Streamable HTTP expose identical bundle tools.

## Supported selection types

### Pressure-level variables

The bundle accepts the GEFS profile-variable contract, currently including raw `pgrb2a` pressure variables and member-first derived:

- `dew_point`;
- `potential_temperature`.

Derived quantities are evaluated **inside each member** before ensemble aggregation. WFG does not derive nonlinear quantities from the ensemble mean state.

### Non-isobaric fields

The current verified `pgrb2a` field catalog includes:

- surface pressure;
- 2 m temperature and relative humidity;
- 10 m U/V wind and derived vector wind;
- total precipitation;
- precipitable water;
- total-atmosphere cloud cover;
- 180–0 hPa AGL CAPE and CIN;
- mean sea-level pressure.

The catalog remains product-specific. It does not imply support for unimplemented `pgrb2b`, 0.25° select products, or fields not present in the WFG GEFS catalog.

## Temporal semantics

Field temporal semantics are not flattened away:

- instantaneous fields remain instantaneous;
- precipitation carries its decoded accumulation forecast-hour window and absolute start/end times;
- total cloud cover carries its decoded average interval and absolute start/end times.

A time-series result can therefore contain fields with different time semantics at the same forecast step. Consumers should use each field's `temporal` metadata rather than treating every value as a point observation.

## Wind direction

Wind speed is summarized as an ordinary numeric ensemble distribution. Direction is circular data: averaging `350°` and `10°` as scalar numbers would incorrectly produce `180°`.

WFG therefore returns for wind direction:

- circular mean direction in degrees;
- resultant length from 0 to 1 as a measure of directional concentration.

It deliberately does not return ordinary scalar direction quantiles.

## Ensemble semantics

Bundle summaries contain model-member distributions. They are not calibrated real-world probability or uncertainty. When individual members are omitted, the summary still reflects member-first computation; omission is only a response-size choice.

## Composition invariants

The time-series composers:

1. validate the complete range and response guardrails before upstream calls;
2. resolve `latest` once to a GEFS cycle that can satisfy the whole range;
3. use native three-hour valid times;
4. call the relevant single-time primitive with that explicit cycle for every step;
5. reject run, valid-time, forecast-hour, selection, point-order, or sampled-grid drift;
6. preserve each field's own decoded temporal interval;
7. aggregate cache state over the complete series.

This keeps temporal composition separate from meteorological decoding and makes the single-time mixed bundle decoder reusable across point, multi-point, and time-series operations.
