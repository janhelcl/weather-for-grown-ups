# Historical GFS parcel diagnostics

WFG applies the same deterministic parcel-ascent engine used by operational GFS to `gfs-analysis` on the historical 0.5° Grid 4 product.

Historical parcel diagnostics answer questions such as:

- What did the model-analysis sounding imply for a surface parcel during a past event?
- How did analyzed CAPE/CIN evolve across several historical 12 UTC cycles?
- Was the most-unstable parcel materially different from the surface parcel on a historical day?

The source state is **GFS model analysis**, not a direct observation, and the long GFS record is not a homogeneous climatological reanalysis. The resulting CAPE/CIN therefore describe the shared parcel calculation applied to the model-analysis state, not observational truth or a climate-normal quantity.

Transport is separate from that scientific identity. Historical Grid 4 state may resolve through NOAA AWS Open Data, NCEI fileServer or NCEI NCSS according to era/operation; the result preserves whichever provider/access route actually served the request. See [HISTORY.md](HISTORY.md#one-historical-product-several-transports).

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

There is no separate historical CAPE algorithm. The source adapter changes; the parcel physics does not.

## Historical state construction

The environmental pressure profile requests:

- `temperature`;
- `specific_humidity`;
- `geopotential_height`;

at exactly the pressure levels supplied by the caller. Historical pressure-level specific humidity uses WFG's long-record derivation from archived temperature/RH/pressure where native SPFH is not stable across model eras.

The near-surface parcel state requests:

- `surface_pressure`;
- `surface_geopotential_height`;
- `temperature_2m`;
- `relative_humidity_2m`.

WFG derives 2 m specific humidity from 2 m temperature, 2 m relative humidity and surface pressure using the shared thermodynamic conversion. This avoids making historical parcel availability depend on native 2 m specific-humidity fields that vary across archive eras.

Environmental vertical resolution is controlled entirely by `pressureLevelsHpa`. WFG does not invent missing archive levels. Parcel-path interpolation required by the shared diagnostic engine remains internal to the parcel calculation; the source environmental sounding is exactly the requested published pressure surfaces.

## Single historical parcel

CLI:

```bash
wfg diagnose \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --kind parcel \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300 \
  --parcel surface_2m \
  --json
```

MCP tool: `diagnose_atmosphere`.

The result includes the exact analysis time, requested and sampled Grid 4 point, pressure levels used, normalized environmental state, parcel computation, resolved source provenance and cache state.

## Historical parcel time series

CLI:

```bash
wfg diagnose \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --from 2017-05-09T00:00:00Z \
  --to 2017-05-15T23:59:59Z \
  --cycles 12 \
  --kind parcel \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300 \
  --parcel most_unstable_300hpa \
  --max-steps 7 \
  --json
```

MCP tool: `diagnose_atmosphere`.

The time-series primitive uses the same guardrails as the rest of interactive history:

- native 00/06/12/18 UTC analysis cycles only;
- default `maxSteps=8`;
- hard maximum `16`;
- selected cycles evaluated serially;
- each step retains the source/object identity and cache state of its resolved route.

It is intentionally not an unbounded historical CAPE scanner. Multi-year statistical questions should be served from deliberately materialized/indexed data rather than thousands of interactive upstream requests.

## Interpretation caveats

Historical parcel diagnostics inherit two important limitations:

1. **Model-analysis semantics.** The environmental sounding is the GFS assimilated/model state, not a radiosonde or other direct observation.
2. **Changing historical GFS.** The archive spans multiple GFS versions and assimilation systems. A long CAPE/CIN series from raw GFS analysis is not a homogeneous climatology.

For climatological percentiles, trends or return periods, use a deliberately homogeneous reanalysis/climatology source instead of treating the evolving GFS archive as climate truth.
