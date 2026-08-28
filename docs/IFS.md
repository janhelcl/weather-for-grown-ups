# ECMWF IFS operational and ensemble access

WFG exposes both ECMWF's deterministic IFS Open Data forecast and the perturbed IFS ENS distribution through the same atmospheric query vocabulary used for GFS and GEFS.

## Current source contract

- public dataset: `ifs`
- internal dataset: `ifs_0p25`
- horizontal grid: 0.25°
- source: ECMWF Open Data, using AWS first with Google/ECMWF HTTPS mirror failover
- product: deterministic IFS operational forecast (`oper`, `fc`)
- cycles: 00/06/12/18 UTC
- 00/12Z horizon: `f000`–`f240`
- 06/18Z horizon: `f000`–`f090`
- cadence: 3-hourly through `f144` on 00/12Z then 6-hourly from `f150` through `f240`; 06/18Z is 3-hourly through `f090`
- pressure levels: 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 hPa
- transport: JSON-lines `.index` inventory + exact HTTP byte ranges, with bounded retry/failover across official mirrors
- decoding: bundled GRIB2 decoder, including ECMWF CCSDS/AEC packing

The source adapter resolves `latest` against the **requested selection**, not merely the newest cycle name. If a newly initializing cycle has not yet published the requested fields at the required lead, WFG walks back to the newest cycle that can satisfy the complete point request.

## IFS ENS

The public dataset `ifs-ens` exposes ECMWF's atmospheric ensemble direct model output:

- internal dataset: `ifs_ens_0p25`
- product: `stream=enfo`, file type `ef` (perturbed forecasts are `type=pf` in MARS/index metadata)
- members: `p01`–`p50`
- 00/12Z horizon: `f000`–`f360`, 3-hourly through `f144` then 6-hourly
- 06/18Z horizon: `f000`–`f144`, 3-hourly
- first public slice: one point × one valid time, pressure variables and/or supported IFS fields
- derived quantities are calculated independently inside every perturbation before aggregation
- outputs include member count, mean, population standard deviation, min/max and requested quantiles; wind direction uses circular statistics
- raw normalized perturbation payloads are opt-in with `ensemble.includeMembers`

Since IFS Cycle 50r1, ECMWF no longer publishes a distinct ENS control in `enfo`: the unperturbed control is identical to deterministic `oper/fc`. WFG therefore keeps the 50 perturbations in `ifs-ens` and exposes the control truthfully as `dataset: "ifs"`, rather than inventing a `c00` member.

Example:

```json
{
  "dataset": "ifs-ens",
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
    "fields": ["temperature_2m", "wind_10m"]
  },
  "ensemble": {
    "members": ["p01", "p02", "p03", "p04"],
    "quantiles": [0.1, 0.5, 0.9],
    "includeMembers": false
  }
}
```

The default member selection is all 50 perturbations. Point ranges, multi-point, transects, areas, diagnostics and ensemble run comparison are intentionally rejected for now instead of being routed through deterministic IFS semantics.

## Current deterministic IFS query surface

IFS now exposes the same deterministic state through several geometries while pinning one initialization per composed request:

- one point at one valid time;
- one-point time series on the native IFS cadence;
- multi-point sampling at one valid time;
- multi-point time series with an explicit point × time guardrail;
- great-circle transects at one valid time;
- raw scalar bbox area statistics at one valid time, with mean/min/max plus optional percentiles, threshold fractions and extrema locations;
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

No IFS-specific MCP tool is added. The same `diagnose_atmosphere` / `wfg diagnose` surface supports IFS layer, whole-profile, and parcel diagnostics at one valid time or across a valid-time range. The generic `compare_runs` / `wfg compare-runs` operation also supports deterministic IFS cycles.

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
- run-static surface geopotential height, read from ECMWF `z` at `f000` and normalized from geopotential to gpm;
- 2 m temperature and dew point;
- derived 2 m relative humidity and specific humidity (from temperature/dew point, plus surface pressure for specific humidity);
- 10 m U/V wind and derived wind;
- 100 m U/V wind and derived wind;
- total precipitation;
- total-column water vapour / precipitable water;
- low, middle, high and total cloud cover.

Units are normalized at the model boundary: temperatures to °C, precipitation metres to millimetres, fractional cloud cover to percent, and surface geopotential to geopotential metres using standard gravity. Run-static fields are fetched from their native source step and composed with the requested forecast step transparently.

## Composition and source reuse

Time ranges resolve one selection-capable IFS initialization for the complete range and keep it fixed. Native output cadence is preserved rather than resampled. Multi-point and transect operations reuse immutable selected-message cache entries, so adding points does not multiply upstream ECMWF downloads for the same run/lead/selection.

## Diagnostics

IFS reuses WFG's normalized deterministic kernels for layer, whole-profile, and parcel diagnostics:

- environmental temperature lapse rate;
- vector wind shear and depth-normalized shear;
- potential-temperature gradient;
- freezing-level crossings;
- sampled temperature-inversion layers;
- surface, 100 hPa mixed-layer, and lowest-300 hPa most-unstable parcels;
- LCL, LFC, equilibrium level, CAPE, CIN, and the explicit parcel path.

Parcel physics are the same model-independent implementation used by deterministic GFS. IFS supplies the environmental sounding from pressure-level temperature, specific humidity and geopotential height; surface initialization uses surface pressure, 2 m temperature, derived 2 m specific humidity, and the run-static surface geopotential field.

The IFS adapter fetches only the required pressure variables and keeps ECMWF run, lead, sampled grid point and source provenance attached to the derived result. Diagnostic ranges pin one selection-capable IFS run and evaluate the same single-time kernels at each native output: three-hourly through f144 and, for 00/12Z runs, six-hourly thereafter. Compact parcel time-series steps omit the full parcel path while preserving the scalar parcel diagnostics and starting state.

## Area statistics and run comparison

IFS bbox aggregation reuses WFG's deterministic spatial-distribution kernel over the native 0.25° grid. Like deterministic GFS area summaries, the area contract intentionally accepts one **raw** pressure variable at one pressure level or one **raw** field at a time. Results include an unweighted grid-point mean, min/max and defined-grid-point count, with optional spatial percentiles, threshold fractions and representative extrema locations. ECMWF unit normalization is applied before aggregation, and run-static fields such as surface geopotential are still fetched from their native source step.

Run comparison evaluates consecutive six-hour ECMWF initialization cycles at one fixed valid time. Runs are returned oldest to newest and every numeric delta is `newer - older`. Directional fields use shortest circular degree deltas. Non-isobaric fields are compared only when their vertical and temporal semantics match; for example, total precipitation accumulated from different initialization times is reported as non-comparable rather than subtracting different accumulation windows. At long lead times, a 06/18Z short run that cannot reach the requested valid time causes an explicit failure instead of being silently skipped.

IFS still does not participate in the specialized aligned GFS-vs-GEFS comparison operation, which has model-pair-specific ensemble semantics rather than being a missing deterministic IFS state capability.

This keeps the architecture rule intact: **unify operations and physics; preserve model semantics.**
