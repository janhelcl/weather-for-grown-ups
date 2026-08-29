# Architecture

Weather for Grown Ups is primarily a **numerical-weather-model access and meteorology product**, not a forecast interpretation layer.

```text
NOAA GFS / GEFS / ECMWF IFS / IFS ENS / NCEI historical GFS
      ↓
dataset-specific catalogs, time semantics and source adapters
      ↓
normalized atmospheric states and mixed-field bundles
      ↓
shared meteorological kernels and composition primitives
      ↓
deterministic result OR member-first ensemble aggregation
      ↓
model-discriminated contracts
      ↓
CLI / MCP stdio / MCP Streamable HTTP
      ↓
agent interpretation
```

The core is the product. CLI and MCP are adapters over it, not independent implementations.

## Core design rule

> **Unify operations and physics; preserve model semantics.**

A common operation does not imply a common source inventory or a flattened result shape. Deterministic GFS and IFS forecasts return deterministic forecast states. Historical Grid 4 returns deterministic analyzed states. GEFS and IFS ENS return member-derived forecast distributions and structural ensemble summaries.

The engine is organized around **operation × dataset** internally, while the public contract is intentionally organized around one query language: `dataset × geometry × time × selection`. Dataset-specific schemas, source adapters and services are implementation details behind that boundary; adding a model must extend the shared vocabulary and capability registry rather than create another public query namespace.

Nonlinear diagnostics are evaluated independently on every GEFS or IFS ENS member before aggregation. WFG does not calculate CAPE, lapse rate, inversion structure or another nonlinear quantity from an ensemble-mean profile and pretend it represents the members.

## Atmospheric dataset capability boundary

`src/catalog/models.ts` is the explicit atmospheric **dataset** capability registry. The registry uses explicit internal dataset IDs; public CLI/MCP callers use the short dataset IDs `gfs`, `gefs`, `ifs`, `ifs-ens`, and `gfs-analysis`. Public metadata is derived from this registry so role/kind semantics cannot drift into a second source of truth.

| Operation | GFS 0.25° / 0.5° forecast | GEFS forecast | IFS 0.25° forecast | IFS ENS 0.25° forecast | GFS Grid 4 0.5° analysis |
| --- | --- | --- | --- | --- | --- |
| profile | ✅ deterministic | ✅ member distributions | ✅ deterministic | ✅ member distributions | ✅ analyzed state |
| timeseries | ✅ forecast evolution | ✅ ensemble evolution | ✅ native-cadence deterministic evolution | ✅ native-cadence ensemble evolution | ✅ selected analysis cycles |
| layer diagnostics | ✅ | ✅ member-first | ✅ shared kernel | ✅ member-first | ✅ shared kernel |
| profile diagnostics | ✅ | ✅ member-first | ✅ shared kernel | ✅ member-first | ✅ shared kernel |
| parcel diagnostics | ✅ | ✅ member-first | ✅ shared kernel | ✅ member-first | ✅ shared kernel |
| diagnostic time series | ✅ | ✅ compact ensemble summaries | ✅ | ✅ compact ensemble summaries | ✅ selected analysis cycles |
| points | ✅ shared S3 slice | ✅ member slices reused | ✅ cached selected-message reuse | ✅ member-first | ✅ bounded serial NCSS points |
| points time series | ✅ | ✅ | ✅ bounded point × native-time matrix | ✅ bounded point × native-time matrix | ✅ bounded cycle × point matrix |
| transect | ✅ great-circle | ✅ member-first great-circle | ✅ great-circle | ✅ member-first great-circle | ✅ great-circle |
| area summary | ✅ NOMADS bbox | ✅ member-first | ✅ scalar bbox | ✅ member-first scalar bbox | ✅ native NCEI NCSS bbox |
| run comparison | ✅ | ✅ distribution shift | ✅ | ✅ distribution shift | — |
| scalar ensemble distribution | — | ✅ | — | ✅ | — |
| aligned model comparison | ✅ GFS↔GEFS / GFS↔IFS | ✅ GFS↔GEFS / GEFS↔IFS ENS | ✅ GFS↔IFS | ✅ GEFS↔IFS ENS | —; verification is separate |

The capability registry describes the shared **core operation** behind the compact public vocabulary. Historical analog search and archived forecast verification remain specialized composition primitives, while index build/backfill is CLI-only administration rather than a normal atmospheric query.

It also prevents two failure modes: mechanically copying deterministic behavior into an ensemble namespace, and claiming a model supports an operation whose required source fields or semantics are not actually implemented.

## Normalized atmospheric boundary

Pressure-profile meteorology consumes normalized typed states rather than GRIB records directly.

```text
GFS forecast profile ---------------------┐
                                           │
IFS deterministic profile -----------------┤
                                           │
historical GFS analysis profile -----------├─> normalized pressure states ─> shared physics
                                           │
GEFS member profile ─> member -------------┤
                                           │
IFS ENS member profile ─> member ----------┘
```

This keeps physical formulas model-independent while leaving model identity, source inventory, cycle semantics and result shape explicit.

Ensemble datasets expose mixed pressure/non-isobaric **field bundles** where their native source inventory supports them. A bundle may combine pressure-level variables with fields such as 2 m temperature/RH, 10 m wind, precipitation, precipitable water, cloud cover, CAPE/CIN or MSLP. Raw dependencies are resolved by the dataset adapter; derived thermodynamics remain member-first.

## Shared meteorological kernels

The shared core owns model-independent calculations including:

- thermodynamic profile derivations;
- environmental temperature lapse rate;
- vector wind shear;
- potential-temperature gradient;
- freezing-level crossings;
- sampled inversion layers;
- parcel start-state construction;
- LCL/LFC/EL;
- pseudo-adiabatic parcel paths;
- virtual-temperature buoyancy, CAPE and CIN.

GFS and deterministic IFS evaluate these once on their deterministic state. GEFS and IFS ENS evaluate them independently for each member and summarize only after those calculations are complete.

Parcel definitions remain explicit: `surface_2m`, `mixed_layer_100hpa`, and `most_unstable_300hpa`. Both ensemble datasets keep parcel diagnostics member-first.

## Ensemble statistics

`src/core/ensemble-statistics.ts` centralizes numeric ensemble summaries:

- arithmetic mean;
- population standard deviation;
- min/max;
- caller-selected quantiles;
- raw member threshold fractions.

Where structures have variable length — freezing crossings or inversion layers, for example — WFG summarizes comparable descriptors and conditional distributions rather than averaging structures themselves.

Member threshold/event fractions retain the interpretation that they are **raw model-member evidence, not calibrated probability**.

## Spatial and temporal composition

WFG builds larger queries by composing smaller atmospheric primitives while preserving a fixed model cycle and stable sampling semantics.

### GFS

- multi-point requests reuse selected NOAA AWS messages across coordinates;
- time series fix one run across the requested range;
- transects generate great-circle samples and delegate to batch point queries;
- diagnostic series reuse the corresponding single-time physical services;
- bounded area queries decode a geographic subset locally and return statistics rather than raw grids;
- run comparison holds valid time constant across consecutive initialization cycles.

### Historical GFS analysis

Historical Grid 4 participates in the same profile, time-series, layer-diagnostic, profile-diagnostic, parcel, multi-point, multi-point-time-series, transect and area-summary operation boundaries as operational data. Its source adapter preserves exact 00/06/12/18 UTC analysis semantics, 0.5° sampling, NCEI provenance and bounded archive access.

- diagnostic time series compose the same layer/profile/parcel kernels over selected analysis cycles;
- multi-point requests are bounded to 10 coordinates and use the NCEI THREDDS/NCSS provider policy rather than the NOMADS courtesy interval;
- multi-point time series bound both analysis steps and the point × step matrix;
- transects reuse the same great-circle interpolation as GFS/GEFS and delegate samples to the historical multi-point primitive;
- area statistics use one native NCEI NCSS bbox/grid subset, apply exact vertical-coordinate selection for pressure/height fields, verify the returned vertical coordinate, and reuse the same local spatial distribution kernel as operational GFS.

### GEFS

GEFS composition is **member-first**.

- raw and mixed-field point requests fetch one selected slice per member;
- multi-point requests reuse each member slice across all requested coordinates;
- multi-point time series repeat that reuse across native three-hour steps from one fixed cycle;
- mixed-field transects delegate the full path to one member-first multi-point bundle operation;
- area statistics compute the spatial statistic independently inside every member, then summarize those member-level statistics across the ensemble;
- run comparison summarizes every model cycle independently and compares distributions, never treating repeated perturbation labels as trajectories across cycles.

This preserves separate **space**, **time**, and **ensemble-member** axes instead of flattening them into one sample.

### IFS

Deterministic IFS uses the same public geometry/time vocabulary while preserving ECMWF-native cadence, fixed 0.25° model semantics and selected-message cache reuse. Multi-time operations pin one initialization capable of satisfying the complete range; point, multi-point, transect, area, diagnostics and run comparison all stay deterministic.

### IFS ENS

IFS ENS composition is **member-first** across the 50 perturbed members `p01`–`p50`. Point, multi-point, time-series, transect, area and diagnostic operations evaluate each requested member independently before aggregation. Run comparison compares independently summarized distributions across cycles; it does not pair perturbation labels as trajectories. The deterministic post-Cycle-50r1 unperturbed control remains the separate `ifs` dataset.

## Catalogs and source contracts

GFS, GEFS, deterministic IFS, IFS ENS and historical GFS analysis keep dataset-specific source inventories because their upstream products are not identical. Canonical field IDs and shared physical derivations converge where the quantity is genuinely comparable; unavailable fields remain explicit capability differences rather than being fabricated for symmetry.

Catalogs define:

- canonical variable and field IDs;
- pressure-level availability;
- non-isobaric vertical semantics;
- instantaneous / accumulation / average temporal semantics;
- raw-vs-derived classification;
- physical dependencies;
- model-specific GRIB codes and source units.

The unified catalog is searchable locally from CLI and MCP and reports dataset support for each canonical match. Discovery performs no upstream weather-data request.

## Run semantics

Run selection is query-aware.

GFS, GEFS, deterministic IFS and IFS ENS use explicit 00/06/12/18Z initialization cycles. Multi-time operations resolve one cycle capable of satisfying the complete requested range and then keep that cycle fixed. GFS grid selection is orthogonal to run selection: `0p25` is the default and `0p50` is explicit. An old explicit run keeps the public `gfs` identity and routes to the matching historical forecast archive rather than changing datasets.

ECMWF Open Data preserves different deterministic and ensemble horizons. Deterministic `ifs` uses `oper/fc`: 00/12Z runs publish 3-hourly through `f144`, then 6-hourly through `f240`; 06/18Z runs publish 3-hourly through `f90`. `ifs-ens` uses perturbed `enfo/ef`: 00/12Z runs publish 3-hourly through `f144`, then 6-hourly through `f360`; 06/18Z runs publish 3-hourly through `f144`. `latest` is resolved against the requested field inventory so partially published cycles are not mistaken for selection-capable runs.

GEFS uses control `c00` plus `p01`–`p30` on a native three-hour cadence through `f384`. Pressure-level and mixed pressure/field operations use `pgrb2a` 0.5°. Field-only operations select `pgrb2s` 0.25° through `f240`, then fall back to `pgrb2a` 0.5°. Multi-time field operations choose one product from the complete range and keep that grid fixed.

Historical Grid 4 analysis has no forecast initialization/lead axis: its native time coordinate is the exact 00/06/12/18 UTC analysis cycle. Shared operation dispatch preserves that distinction instead of synthesizing run or forecast-hour fields.

Aligned dataset comparisons resolve one initialization cycle that can satisfy both sides at the requested valid time. GFS↔GEFS preserves deterministic-vs-distribution semantics, GFS↔IFS compares deterministic normalized states, and GEFS↔IFS ENS compares independently summarized ensemble distributions without pairing member labels across centers.

## Data access and caching

### GFS

WFG supports operational GFS at both 0.25° and 0.5°. Source choice is an internal routing decision by default: point/profile, time-series, multi-point, transect, and run-comparison operations use NOAA AWS Open Data `.idx` inventories plus byte ranges, while bounded area operations use NOAA NOMADS because geographic subsetting materially reduces transfer. Explicit source overrides remain available only where the selected geometry can honor them; provenance always reports the resolved backend.

Explicit historical GFS runs route by the selected grid: 0.25° uses NCAR/GDEX d084001 through THREDDS/NCSS (archive start 2015-01-15), while 0.5° uses NOAA NCEI Grid 4 through THREDDS/NCSS (archive start 2006-10-10). Both preserve forecast run, lead, valid time, grid and source provenance. Archive availability is not silently substituted across grids.

Upstream access etiquette is source-specific rather than inherited from NOMADS. NOMADS uses one cross-process slot plus an 11-second minimum interval. NCEI THREDDS/NCSS uses two cross-process slots with no artificial delay, NCAR/GDEX uses four slots (below its published 10-stream ceiling), and IGRA uses four. NOAA AWS and ECMWF cloud/direct transports use their own bounded policies and do not inherit NOMADS pacing. Transient 429/5xx responses are retried with exponential backoff, jitter and `Retry-After` handling where applicable. CLI GFS time-range queries emit native-step progress on stderr, including the resolved source and cache-hit state, so courtesy-paced NOMADS misses are visible rather than looking hung.

### Historical GFS analysis

Historical analysis uses NOAA NCEI Grid 4 through THREDDS/NCSS. Point/profile operations use grid-as-point requests; area summaries use one native bbox/grid subset. Archive reads are immutable and cached; cache misses are bounded by the NCEI provider policy without the NOMADS 11-second delay. Pressure/height area queries request an exact vertical coordinate and reject NCSS nearest-level substitution when the returned coordinate does not match. Source and analysis provenance stay attached to every result.

### GEFS

GEFS uses member-specific NOAA AWS `pgrb2a` 0.5° and `pgrb2s` 0.25° objects with `.idx` byte ranges. The source adapter selects the product from pressure-vs-field semantics and forecast horizon; the chosen product and `horizontalGridDegrees` are retained in result provenance. Immutable selected-message slices are cached locally with product-aware keys, then decoded and sampled/derived locally.

Member work is bounded-concurrent. Multi-point and transect operations deliberately reuse upstream member slices rather than multiplying upstream transfer by point count.

### IFS / IFS ENS

ECMWF access uses official Open Data indexed byte ranges with bounded mirror retry/failover and immutable local caching. Deterministic and ENS products keep their native product, cadence, run and member provenance. The source layer resolves model-specific filenames/messages; the public query layer only sees canonical dataset, geometry, time and selection semantics.

## GRIB decoding

The normal npm path uses the bundled GRIB2 decoder supplied by `@mattnucc/gribberish`, so users do **not** need to install native `wgrib2` for CLI or MCP use.

Native `wgrib2` remains an explicit compatibility/debug backend selected through `WGRIB2_PATH` or `WFG_DECODER=wgrib2`. The Docker image includes native `wgrib2` as that reproducible fallback path.

The rest of the codebase is isolated from decoder choice behind a narrow decoding abstraction and works with typed meteorological values rather than raw GRIB internals.

## Public surfaces

The public contract mirrors the core architecture instead of the order in which model-specific features were implemented.

> **One query language for atmospheric state; datasets preserve their semantics.**

Normal access is `dataset × geometry × time × selection`. Public dataset IDs are `gfs`, `gefs`, `ifs`, `ifs-ens`, and `gfs-analysis`; they map to the explicit internal dataset registry. Dataset-native result semantics remain unchanged.

### CLI

The CLI surface is compact:

- `catalog --dataset ...` for cross-dataset discovery;
- `query` for atmospheric state over point(s), time range, transect, or area where supported;
- `diagnose` for shared layer/profile/parcel physics;
- `compare-runs`, `compare-datasets`, `verify`, and `analogs` for composition operations;
- `index build` and `index backfill` for local analog-index administration.

### MCP

The MCP vocabulary is similarly small:

- `search_catalog`;
- `query_atmosphere`;
- `diagnose_atmosphere`;
- `compare_runs`;
- `compare_datasets`;
- `verify_forecast`;
- `find_analogs`.

The first three are the normal atmospheric query language. Comparison, verification and analog search remain separate because they are genuine composition operations rather than another geometry/time shape.

The unified adapters validate the common request and then delegate through dataset-specific schemas/services internally, so unsupported combinations fail explicitly rather than being coerced into fake symmetry. Those dataset-native services are implementation details and are not registered as separate public MCP tools.

Both MCP transports instantiate the same tool catalog:

- **stdio** for local process-spawned clients;
- **Streamable HTTP** for hosted/remote clients.

The HTTP launcher adds transport concerns only: `/mcp`, `/healthz`, loopback-safe defaults and Host/Origin protection. It does not define separate meteorological behavior.

## Core does not own

- activity-specific weather scores;
- subjective forecast interpretation;
- turbine power curves or energy-production models;
- route/summit/flight safety decisions;
- calibrated probability unless a dedicated calibration layer is explicitly designed and validated.

Those belong to the consuming agent or a specialized application built on top of WFG.
