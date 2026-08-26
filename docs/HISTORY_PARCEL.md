# Historical GFS parcel diagnostics

WFG can apply the same deterministic parcel-ascent engine used by operational GFS to archived NOAA NCEI GFS Grid 4 analyses.

Historical parcel diagnostics answer questions such as:

- What did the model-analysis sounding imply for a surface parcel during a past event?
- How did analyzed CAPE/CIN evolve across several historical 12 UTC cycles?
- Was the most-unstable parcel materially different from the surface parcel on a historical day?

The source is **GFS model analysis on the historical 0.5° Grid 4 archive**. It is not a direct observation and the long GFS archive is not a homogeneous climatological reanalysis. The resulting CAPE/CIN therefore describe the parcel calculation applied to the model-analysis state, not observational truth or a climate-normal quantity.

## Shared parcel engine

History supports the same explicit parcel definitions as deterministic GFS:

- `surface_2m` — initialize from surface pressure/geopotential height and 2 m thermodynamics;
- `mixed_layer_100hpa` — construct the parcel from the lowest 100 hPa of the supplied environment;
- `most_unstable_300hpa` — select the highest equivalent-potential-temperature source within the lowest 300 hPa.

For every definition WFG derives the same parcel structures as operational GFS:

- starting parcel state;
- LCL;
- LFC when present;
- equilibrium level when present;
- CAPE and CIN;
- explicit parcel path including dry/saturated phase and buoyancy information.

There is no separate "historical CAPE algorithm". The source adapter changes; the parcel physics does not.

## Historical state construction

The environmental pressure profile requests:

- `temperature`
- `specific_humidity`
- `geopotential_height`

at exactly the pressure levels supplied by the caller. Historical pressure-level specific humidity uses WFG's long-record derivation from archived temperature/RH/pressure where native SPFH is not stable across model eras.

The near-surface parcel state requests:

- `surface_pressure`
- `surface_geopotential_height`
- `temperature_2m`
- `relative_humidity_2m`

WFG derives 2 m specific humidity from 2 m temperature, 2 m relative humidity and surface pressure using the shared thermodynamic conversion. This deliberately avoids making historical parcel availability depend on native 2 m specific-humidity fields that vary across archive eras.

Environmental vertical resolution is controlled entirely by `pressureLevelsHpa`. WFG does not invent missing archive levels. Parcel-path interpolation required by the parcel calculation (for example LCL or buoyancy crossings) remains part of the shared diagnostic engine, but the source environmental sounding is exactly the requested published pressure surfaces.

## Single historical parcel

CLI:

```bash
wfg history-parcel \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300 \
  --parcel surface_2m \
  --json
```

MCP tool: `get_gfs_historical_parcel`.

The returned result includes the exact analysis time, requested and sampled Grid 4 point, pressure levels used, complete normalized environmental profile, parcel computation, exact NCEI dataset path and cache status.

## Historical parcel time series

CLI:

```bash
wfg history-parcel-timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --from 2017-05-09T00:00:00Z \
  --to 2017-05-15T23:59:59Z \
  --cycles 12 \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300 \
  --parcel most_unstable_300hpa \
  --max-steps 7 \
  --json
```

MCP tool: `get_gfs_historical_parcel_timeseries`.

The time-series primitive uses the same guardrails as the rest of interactive History:

- native 00/06/12/18 UTC analysis cycles only;
- default `maxSteps=8`;
- hard maximum `16`;
- all selected cycles evaluated serially;
- every step retains its archive dataset path and cache-hit status.

It is intentionally not an unbounded historical CAPE scanner. Multi-year statistical questions should eventually be served from deliberately materialized/indexed diagnostic data rather than thousands of interactive NCEI calls.

## Interpretation caveats

Historical parcel diagnostics inherit two important limitations:

1. **Model-analysis semantics.** The environmental sounding is the GFS assimilated/model state, not a radiosonde or other direct observation.
2. **Changing historical GFS.** The archive spans multiple GFS versions and assimilation systems. A long CAPE/CIN series from raw GFS analysis is therefore not a homogeneous climatology.

For climatological percentiles, trends or return periods, WFG should use a deliberately homogeneous reanalysis/climatology source instead of treating the evolving GFS archive as climate truth.
