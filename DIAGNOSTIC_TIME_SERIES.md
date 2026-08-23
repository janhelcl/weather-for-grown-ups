# Diagnostic time series

WFG can evaluate its existing deterministic diagnostics across the native NOAA GFS 0.25° forecast timeline. This is a composition layer over the single-time diagnostic services, not a second meteorology implementation.

## Why this exists

Single-time diagnostic tools are ideal for inspecting one forecast instant in detail. Agents often need a different question shape:

- when does CAPE peak?
- how does LCL evolve through the afternoon?
- when do sampled freezing-level crossings move upward or downward?
- when do sampled inversion layers appear or disappear?
- how does lapse rate or vector wind shear evolve between two fixed pressure surfaces?

`diagnostic-timeseries` / `get_gfs_diagnostic_timeseries` answer those questions in one bounded request.

## One diagnostic family per query

The `diagnostic` selection is a discriminated union with three kinds.

### Layer

```json
{
  "kind": "layer",
  "lowerPressureHpa": 850,
  "upperPressureHpa": 700,
  "diagnostics": ["temperature_lapse_rate", "wind_shear"]
}
```

The pressure surfaces stay fixed for the full series.

### Whole profile

```json
{
  "kind": "profile",
  "pressureLevelsHpa": [1000, 925, 850, 700, 500],
  "diagnostics": ["freezing_level_crossings", "temperature_inversion_layers"]
}
```

The supplied published pressure levels define vertical sampling resolution at every time step. WFG does not imply structure between levels the caller did not request.

### Parcel

```json
{
  "kind": "parcel",
  "pressureLevelsHpa": [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200],
  "parcel": "surface_2m"
}
```

The explicit parcel definition and sampled environmental pressure levels stay fixed for the full series.

## Time semantics

The caller supplies an inclusive `startTime` and `endTime`. WFG returns every native GFS output falling inside that range:

- hourly through forecast hour 120;
- every three hours after forecast hour 120 through f384.

`maxSteps` bounds the response before any diagnostic data access begins. The default is the same bounded value used by ordinary point time series.

## Run selection

The entire series uses one GFS model cycle.

- `latest` resolves the newest cycle whose already-published data can satisfy the complete requested time range **and the exact raw dependencies required by the chosen diagnostic**;
- `latest_complete` resolves the newest cycle published through f384;
- an explicit 00Z/06Z/12Z/18Z run timestamp is reproducible.

After resolution, the explicit run timestamp is passed to every underlying single-time diagnostic call. The model cycle therefore cannot drift halfway through a series.

## Data access

S3 is the default because diagnostic time series require several forecast files and NOAA AWS Open Data is the efficient multi-time path. WFG selects only the required GRIB messages from each forecast file and uses the normal immutable slice cache.

`source: "nomads"` remains available explicitly. Every physical NOMADS request still passes through the shared file-backed 11-second courtesy limiter; diagnostic time series have no bypass.

## Compact parcel steps

The single-time `parcel` / `get_gfs_parcel_diagnostics` surface returns the complete parcel path and raw environmental profile for auditability.

Repeating a full parcel path at every forecast step can make a time-series response unnecessarily large. Parcel time-series steps therefore keep:

- parcel starting state;
- LCL;
- optional LFC and EL;
- CAPE and CIN;
- CAPE/CIN top semantics;

but omit the repeated `parcelPath` array. Use the single-time parcel tool when a particular step needs the full audit trail.

## CLI

Layer diagnostics:

```bash
wfg diagnostic-timeseries \
  --kind layer \
  --lat 50.08 --lon 14.43 \
  --start 2026-08-24T09:00:00Z \
  --end 2026-08-24T18:00:00Z \
  --lower 850 --upper 700 \
  --diagnostics temperature_lapse_rate,wind_shear \
  --json
```

Parcel diagnostics:

```bash
wfg diagnostic-timeseries \
  --kind parcel \
  --lat 50.08 --lon 14.43 \
  --start 2026-08-24T09:00:00Z \
  --end 2026-08-24T18:00:00Z \
  --levels 1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200 \
  --parcel surface_2m \
  --json
```

## MCP

Tool: `get_gfs_diagnostic_timeseries`

Example input:

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "run": "latest",
  "startTime": "2026-08-24T09:00:00Z",
  "endTime": "2026-08-24T18:00:00Z",
  "diagnostic": {
    "kind": "profile",
    "pressureLevelsHpa": [1000, 925, 850, 700, 500],
    "diagnostics": ["freezing_level_crossings", "temperature_inversion_layers"]
  }
}
```

The CLI and MCP adapters call the same core service and validate the same result contract.
