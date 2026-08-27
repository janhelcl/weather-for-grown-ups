# Diagnostic time series

Diagnostic time series are not a separate public operation. They are `diagnose` / `diagnose_atmosphere` with a time range.

The same public shape works for deterministic GFS, member-first GEFS, and historical GFS analysis while preserving each dataset's time semantics.

## Diagnostic families

### Layer

```json
{
  "kind": "layer",
  "lowerPressureHpa": 850,
  "upperPressureHpa": 700,
  "diagnostics": ["temperature_lapse_rate", "wind_shear"]
}
```

### Whole profile

```json
{
  "kind": "profile",
  "pressureLevelsHpa": [1000, 925, 850, 700, 500],
  "diagnostics": ["freezing_level_crossings", "temperature_inversion_layers"]
}
```

### Parcel

```json
{
  "kind": "parcel",
  "pressureLevelsHpa": [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300],
  "parcel": "surface_2m"
}
```

## Forecast time semantics

For `gfs`, the whole range uses one model cycle. `latest` resolves once for the complete range and exact diagnostic dependencies. Native forecast steps inside the range are then evaluated against that fixed run.

Historical `gfs-analysis` uses selected native analysis cycles instead of forecast initialization/lead semantics.

## Compact parcel steps

Single-time parcel diagnostics can return full parcel audit detail. Time-series output keeps compact parcel state, LCL/LFC/EL, CAPE/CIN and associated semantics rather than repeating a full path at every time step.

## CLI

Layer series:

```bash
wfg diagnose \
  --dataset gfs \
  --kind layer \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T09:00:00Z \
  --to 2026-08-24T18:00:00Z \
  --lower 850 --upper 700 \
  --diagnostics temperature_lapse_rate,wind_shear \
  --json
```

Parcel series:

```bash
wfg diagnose \
  --dataset gfs \
  --kind parcel \
  --lat 50.08 --lon 14.43 \
  --from 2026-08-24T09:00:00Z \
  --to 2026-08-24T18:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300 \
  --parcel surface_2m \
  --json
```

## MCP

Tool: `diagnose_atmosphere`.

```json
{
  "dataset": "gfs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "from": "2026-08-24T09:00:00Z",
    "to": "2026-08-24T18:00:00Z"
  },
  "diagnostic": {
    "kind": "profile",
    "pressureLevelsHpa": [1000, 925, 850, 700, 500],
    "diagnostics": ["freezing_level_crossings", "temperature_inversion_layers"]
  }
}
```
