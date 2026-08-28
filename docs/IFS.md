# ECMWF IFS operational access

WFG exposes ECMWF's deterministic IFS Open Data forecast through the same atmospheric query vocabulary used for GFS and GEFS.

## Current source contract

- public dataset: `ifs`
- internal dataset: `ifs_0p25`
- horizontal grid: 0.25°
- source: ECMWF Open Data, using AWS first with Google/ECMWF HTTPS mirror failover
- product: deterministic IFS operational forecast (`oper`, `fc`)
- cycles: 00/06/12/18 UTC
- 00/12Z horizon: `f000`–`f360`
- 06/18Z horizon: `f000`–`f144`
- cadence: 3-hourly through `f144`; 00/12Z then 6-hourly from `f150` through `f360`
- pressure levels: 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 hPa
- transport: JSON-lines `.index` inventory + exact HTTP byte ranges, with bounded retry/failover across official mirrors
- decoding: bundled GRIB2 decoder, including ECMWF CCSDS/AEC packing

The source adapter resolves `latest` against the **requested selection**, not merely the newest cycle name. If a newly initializing cycle has not yet published the requested fields at the required lead, WFG walks back to the newest cycle that can satisfy the complete point request.

## Current IFS query surface

IFS now exposes the same deterministic state through several geometries while pinning one initialization per composed request:

- one point at one valid time;
- one-point time series on the native IFS cadence;
- multi-point sampling at one valid time;
- multi-point time series with an explicit point × time guardrail;
- great-circle transects at one valid time;
- pressure-level variables and/or selected non-isobaric fields throughout;
- deterministic normalized output with explicit run, lead, sampled grid point and ECMWF provenance.

Use the same public query operation as the other models:

```json
{
  "dataset": "ifs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind", "dew_point"],
    "pressureLevelsHpa": [850, 500],
    "fields": ["temperature_2m", "wind_10m", "total_precipitation"]
  },
  "forecast": {
    "run": "latest"
  }
}
```

CLI:

```bash
wfg query \
  --dataset ifs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --vars temperature,wind,dew_point \
  --levels 850,500 \
  --fields temperature_2m,wind_10m,total_precipitation \
  --run latest \
  --json
```

No IFS-specific MCP tool is added. The same `diagnose_atmosphere` / `wfg diagnose` surface also supports IFS layer and whole-profile diagnostics at one valid time.

## Canonical pressure variables

Raw Open Data pressure fields currently mapped into WFG are:

- temperature;
- relative humidity;
- U/V wind;
- geopotential height;
- specific humidity;
- pressure vertical velocity;
- relative vorticity, normalized to canonical **absolute vorticity** by adding the latitude-dependent Coriolis parameter;
- horizontal divergence.

Where their dependencies are available, WFG reuses the same model-independent derived kernels as GFS for wind, dew point, potential temperature, mixing ratio, virtual temperature, air density, wet-bulb temperature and equivalent potential temperature.

## Canonical fields

The first slice includes:

- surface pressure;
- 2 m temperature and dew point;
- derived 2 m relative humidity and specific humidity (from temperature/dew point, plus surface pressure for specific humidity);
- 10 m U/V wind and derived wind;
- 100 m U/V wind and derived wind;
- total precipitation;
- total-column water vapour / precipitable water;
- low, middle, high and total cloud cover.

Units are normalized at the model boundary: temperatures to °C, precipitation metres to millimetres, and fractional cloud cover to percent.

## Composition and source reuse

Time ranges resolve one selection-capable IFS initialization for the complete range and keep it fixed. Native output cadence is preserved rather than resampled. Multi-point and transect operations reuse immutable selected-message cache entries, so adding points does not multiply upstream ECMWF downloads for the same run/lead/selection.

## Diagnostics

IFS reuses WFG's normalized deterministic pressure-profile kernels for the full current layer and whole-profile diagnostic catalogs:

- environmental temperature lapse rate;
- vector wind shear and depth-normalized shear;
- potential-temperature gradient;
- freezing-level crossings;
- sampled temperature-inversion layers.

The IFS adapter fetches only the required pressure variables and keeps ECMWF run, lead, sampled grid point and source provenance attached to the derived result.

## Deliberate capability boundary

IFS **area statistics, parcel diagnostics and diagnostic time series** remain unsupported in this slice. Parcel computation is intentionally deferred until the required near-surface humidity and geopotential inputs are verified in the ECMWF Open Data inventory. Unsupported operations fail explicitly rather than being emulated with another model or hidden repeated public calls.

This keeps the architecture rule intact: **unify operations and physics; preserve model semantics.**
