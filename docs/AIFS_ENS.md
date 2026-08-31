# ECMWF AIFS ENS

WFG exposes ECMWF **AIFS ENS** as the public dataset `aifs-ens`.

It uses the same atmospheric question as the other forecast datasets while preserving AIFS ENS's native stochastic-ensemble semantics.

## Public identity

- public dataset: `aifs-ens`
- internal dataset: `aifs_ens_0p25`
- provider: ECMWF
- model class: AI
- kind: ensemble forecast
- Open Data model path: `aifs-ens`
- stream: `enfo`
- horizontal grid: 0.25°
- cycles: 00, 06, 12 and 18 UTC
- native output cadence: 6 hours
- maximum forecast lead: f360
- members: 51 — `c00,p01..p50`

## Member semantics

AIFS ENS is not AIFS Single plus perturbations.

The control member is a dedicated AIFS ENS forecast initialized from unperturbed control initial conditions, but the AIFS ENS model itself remains stochastic. WFG therefore keeps:

- `aifs` = AIFS Single, deterministic AI forecast;
- `aifs-ens:c00` = stochastic AIFS ENS control;
- `aifs-ens:p01..p50` = 50 perturbed AIFS ENS members.

No synthetic control is created and AIFS Single is not inserted as a 52nd ensemble member.

ECMWF Open Data packages the control separately as `type=cf` and the 50 perturbations together as `type=pf`. WFG preserves that distinction in source selection while presenting one canonical member vocabulary.

## Inventory

The atmospheric field vocabulary intentionally reuses the verified AIFS v2 inventory already exposed by WFG:

- pressure-level temperature, U/V wind, geopotential, specific humidity and vertical velocity;
- canonical derived pressure thermodynamics where dependencies exist;
- surface pressure/geopotential, mean sea-level pressure, 2 m temperature/dew point, 10 m and 100 m wind, total precipitation, and low/middle/high/total cloud;
- the same variable-specific pressure-level boundary as AIFS Single, including the 10 hPa stratospheric level where the native parameter exists.

This is reuse of a canonical atmospheric inventory, not reuse of deterministic AIFS data.

## Member-first computation

For every supported operation WFG evaluates the deterministic atmospheric transform independently inside each selected AIFS ENS member and aggregates only afterwards.

That rule applies to:

- point profiles and point time series;
- multi-point state and ranges;
- transects;
- area statistics and requested spatial distributions;
- layer diagnostics;
- structural profile diagnostics and diagnostic time series.

Nonlinear meteorology is therefore never computed from an ensemble-mean profile.

Default output summarizes the selected members using numeric distributions and requested quantiles. Raw member payloads remain opt-in where the unified API permits them.

Parcel diagnostics are not advertised in this first AIFS ENS slice, matching the existing explicit AIFS capability boundary.

## Access and caching

For each requested forecast step WFG reads ECMWF Open Data JSON-line indexes and downloads only the GRIB messages required for the selected member and fields.

Control path:

```text
.../<date>/<cycle>z/aifs-ens/0p25/enfo/<date><cycle>0000-<step>h-enfo-cf.grib2
```

Perturbed path:

```text
.../<date>/<cycle>z/aifs-ens/0p25/enfo/<date><cycle>0000-<step>h-enfo-pf.grib2
```

The `pf` file contains all 50 perturbations; WFG filters its index by member number before issuing byte ranges. It does not download the multi-gigabyte member bundle when a query needs one or a few members.

AIFS ENS uses a cache namespace separate from both AIFS Single and IFS ENS.

## Example

```bash
wfg query \
  --dataset aifs-ens \
  --lat 50.08 --lon 14.43 \
  --at 2026-09-01T12:00:00Z \
  --variables temperature,wind,geopotential_height \
  --levels 850,700,500 \
  --fields temperature_2m,wind_10m \
  --members c00,p01,p02,p03 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

The same request is available through MCP `query_atmosphere` with `dataset: "aifs-ens"`.
