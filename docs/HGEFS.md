# NOAA HGEFS

HGEFS is NOAA's hybrid global ensemble: the 31-member physics-based GEFS population combined with the 31-member AI-based AIGEFS population.

WFG exposes it as the public dataset `hgefs` behind the same atmospheric query language used by the other datasets.

## Why HGEFS is not a homogeneous ensemble

The operational population contains two materially different model classes. WFG therefore does not flatten member identity to `c00,p01..p30`, because those labels occur once in each constituent population.

Public HGEFS member IDs are namespaced:

```text
gefs:c00, gefs:p01 ... gefs:p30
aigefs:c00, aigefs:p01 ... aigefs:p30
```

The default population is all 62 members. Explicit hybrid subsets must contain at least two GEFS and two AIGEFS members. For a homogeneous subset, query `gefs` or `aigefs` directly.

## Member-first composition

NOAA's dedicated public HGEFS product exposes ensemble statistics such as mean and spread. WFG does **not** reinterpret those statistics as raw members.

Instead, WFG composes the corresponding operational GEFS and AIGEFS member products:

1. resolve one AIGEFS-capable initialization;
2. pin the GEFS constituent to the same explicit run;
3. select the requested members from each population;
4. normalize requested quantities within each native constituent;
5. retain every selected member sample;
6. aggregate the combined member population only after member-level values or nonlinear diagnostics exist.

This is especially important for layer and profile diagnostics. Lapse rate, wind shear, potential-temperature gradient, freezing levels and inversion structure are derived independently within each selected member before the 62-member hybrid distribution is summarized.

## Cadence and horizon

The public HGEFS capability follows the operational hybrid product:

- four cycles per day;
- native 6-hour valid-time cadence;
- forecast horizon through `f240`;
- 31 GEFS + 31 AIGEFS members.

Point time ranges follow the 6-hour AIGEFS/HGEFS cadence even though GEFS itself has a 3-hour native cadence. WFG joins only the GEFS steps matching the HGEFS valid times.

## Mixed-grid provenance

The dedicated HGEFS statistics are published on a 0.25° grid, but the constituent member products WFG uses are not always sampled on one common grid.

In particular:

- AIGEFS member data are 0.25°;
- GEFS pressure-level member data use the 0.5° `pgrb2a` product;
- GEFS field-only requests may use the 0.25° `pgrb2s` product through `f240`.

WFG therefore reports separate constituent grid points and constituent source metadata. It does not invent one shared sampled grid point for a pressure query.

That distinction is why the current HGEFS capability set is intentionally narrower than either constituent dataset.

## Current WFG capability boundary

Implemented:

- point pressure/field queries;
- point time ranges on the 6-hour hybrid cadence;
- ensemble distributions and optional member payloads;
- instant layer diagnostics;
- instant profile diagnostics.

Intentionally not advertised yet:

- multi-point queries;
- multi-point time series;
- transects;
- area summaries;
- diagnostic time series;
- parcel diagnostics.

Multi-point/transect/area support requires an explicit policy for combining differently sampled constituent grids. Diagnostic time series require retaining exact member structures at every step without weakening the existing context-size guardrails. Parcel diagnostics are unavailable because the AIGEFS surface inventory does not provide the state required by WFG's parcel initialization methods.

Unsupported combinations fail explicitly rather than falling back to a constituent model or silently resampling.

## Common inventory

HGEFS exposes only quantities that WFG can satisfy with compatible semantics in both GEFS and AIGEFS.

Pressure variables include the common temperature, wind-component, geopotential-height, specific-humidity, vertical-velocity and compatible derived-thermodynamic quantities at pressure levels available from both constituent products.

The common non-isobaric field subset currently includes:

- 2 m temperature;
- 10 m U and V wind;
- derived 10 m wind;
- mean sea-level pressure;
- total precipitation.

For exact current support, use:

```bash
wfg catalog --dataset hgefs --json
```

## Provenance

An HGEFS result keeps three levels of identity:

- public model: `hgefs_0p25`, class `hybrid`;
- constituent population: `gefs` / `aigefs`, class `physics` / `ai`;
- native member: `c00` or `p01..p30`.

The source block also keeps the actual GEFS and AIGEFS source metadata and reports whether every constituent read was served from cache.

This is intentional. Hybrid composition is scientifically meaningful information, not an implementation detail to erase.
