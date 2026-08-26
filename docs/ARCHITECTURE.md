# Architecture

Weather for Grown Ups is primarily a **numerical-weather-model access and meteorology product**, not a forecast interpretation layer.

```text
NOAA GFS / GEFS
      ↓
model-specific catalogs, run semantics and source adapters
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

A common operation does not imply a common source inventory or a flattened result shape. Deterministic GFS forecasts return deterministic forecast states. Historical Grid 4 returns deterministic analyzed states. GEFS returns member-derived forecast distributions and structural ensemble summaries.

The engine is organized around **operation × dataset**. Point profiles, time series and meteorological diagnostics are operations; operational GFS, GEFS and historical GFS analysis are datasets with explicit role, grid, source and temporal semantics. Public CLI/MCP wrappers may remain dataset-specific when that gives agents a clearer schema, but they should delegate into the shared operation layer rather than grow independent implementations.

Nonlinear diagnostics are evaluated on each GEFS member before aggregation. WFG does not calculate CAPE, lapse rate, inversion structure or another nonlinear quantity from an ensemble-mean profile and pretend it represents the members.

## Atmospheric dataset capability boundary

`src/catalog/models.ts` is the explicit atmospheric **dataset** capability registry. The filename and model-named exports remain as backward-compatible aliases while engine code moves to dataset vocabulary.

| Operation | GFS 0.25° forecast | GEFS 0.5° forecast | GFS Grid 4 0.5° analysis |
| --- | --- | --- | --- |
| profile | ✅ deterministic | ✅ member distributions | ✅ analyzed state |
| timeseries | ✅ forecast evolution | ✅ ensemble evolution | ✅ selected analysis cycles |
| layer diagnostics | ✅ | ✅ member-first | ✅ same deterministic kernel |
| profile diagnostics | ✅ | ✅ member-first | ✅ same deterministic kernel |
| parcel diagnostics | ✅ | ✅ member-first | ✅ same parcel engine |
| diagnostic time series | ✅ | ✅ | ⏳ parcel series exists; unified layer/profile series pending |
| points | ✅ | ✅ | ⏳ |
| points time series | ✅ | ✅ | ⏳ |
| transect | ✅ | ✅ | ⏳ |
| area summary | ✅ | ✅ | ⏳ |
| run comparison | ✅ | ✅ | — |
| scalar ensemble distribution | — | ✅ | — |
| aligned model comparison | ✅ GFS-vs-GEFS | ✅ GFS-vs-GEFS | ⏳ forecast/analysis comparison remains a history-native verification primitive |

The capability registry describes the shared **core operation**, not necessarily identical CLI command names. That distinction lets each public surface stay ergonomic without duplicating physics. History-native analog search, index/backfill and archived forecast verification remain specialized composition primitives; they do not need to masquerade as forecast operations.

It also prevents two failure modes: mechanically copying deterministic behavior into an ensemble namespace, and claiming a model supports an operation whose required source fields or semantics are not actually implemented.

## Normalized atmospheric boundary

Pressure-profile meteorology consumes normalized typed states rather than GRIB records directly.

```text
GFS forecast profile --------------------┐
                                          │
historical GFS analysis profile ----------├─> normalized pressure states ─> shared physics
                                          │
GEFS member profile ─> member ------------┘
```

This keeps physical formulas model-independent while leaving model identity, source inventory, cycle semantics and result shape explicit.

GEFS also exposes mixed pressure/non-isobaric **field bundles**. A bundle may combine pressure-level variables with fields such as 2 m temperature/RH, 10 m wind, precipitation, precipitable water, cloud cover, CAPE/CIN or MSLP. Raw dependencies are merged into one selected slice per member and supported thermodynamics are derived member by member.

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

GFS evaluates these once on its deterministic state. GEFS evaluates them independently for each member and summarizes only after those calculations are complete.

Parcel definitions remain explicit: `surface_2m`, `mixed_layer_100hpa`, and `most_unstable_300hpa`. GEFS v0.1.0 supports member-first parcel diagnostics and parcel diagnostic time series using its expanded pressure and non-isobaric source contract.

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

Historical Grid 4 currently participates in the same profile, time-series, layer-diagnostic, profile-diagnostic and parcel-operation boundaries as operational data. Its source adapter preserves exact 00/06/12/18 UTC analysis semantics, 0.5° sampling, NCEI provenance and bounded serial archive access. Spatial parity (points, transects and area statistics) is intentionally represented as missing capability in the registry rather than hidden behind a separate history architecture.

### GEFS

GEFS composition is **member-first**.

- raw and mixed-field point requests fetch one selected slice per member;
- multi-point requests reuse each member slice across all requested coordinates;
- multi-point time series repeat that reuse across native three-hour steps from one fixed cycle;
- mixed-field transects delegate the full path to one member-first multi-point bundle operation;
- area statistics compute the spatial statistic independently inside every member, then summarize those member-level statistics across the ensemble;
- run comparison summarizes every model cycle independently and compares distributions, never treating repeated perturbation labels as trajectories across cycles.

This preserves separate **space**, **time**, and **ensemble-member** axes instead of flattening them into one sample.

## Catalogs and source contracts

Operational GFS, GEFS and historical GFS analysis keep dataset-specific source inventories because their upstream products are not identical. Canonical field IDs and shared physical derivations should converge where the archived quantity is genuinely comparable; unavailable historical fields remain explicit capability differences.

Catalogs define:

- canonical variable and field IDs;
- pressure-level availability;
- non-isobaric vertical semantics;
- instantaneous / accumulation / average temporal semantics;
- raw-vs-derived classification;
- physical dependencies;
- model-specific GRIB codes and source units.

Both catalogs are searchable locally from CLI and MCP. Search itself performs no NOAA request.

## Run semantics

Run selection is query-aware.

GFS and GEFS use explicit 00/06/12/18Z initialization cycles. Multi-time operations resolve one cycle capable of satisfying the complete requested range and then keep that cycle fixed.

GEFS v0.1.0 uses the operational atmospheric `pgrb2a` 0.5° product, control `c00` plus `p01`–`p30`, native three-hour output and a WFG contract through `f384`.

Historical Grid 4 analysis has no forecast initialization/lead axis: its native time coordinate is the exact 00/06/12/18 UTC analysis cycle. Shared operation dispatch preserves that distinction instead of synthesizing run or forecast-hour fields.

Aligned GFS-vs-GEFS comparison resolves one initialization cycle that can satisfy both models at the requested valid time, while preserving their distinct sampled grids.

## Data access and caching

### GFS

WFG uses NOAA NOMADS where geographic subsetting materially reduces transfer and NOAA AWS Open Data `.idx` inventories plus byte ranges where selected messages can be reused across locations or forecast steps.

Physical NOMADS requests pass through the shared cross-process courtesy limiter. AWS Open Data paths do not use the NOMADS scripted-access limiter.

### Historical GFS analysis

Historical analysis uses NOAA NCEI Grid 4 through THREDDS/NCSS grid-as-point requests. Archive reads are immutable and cached; cache misses remain serial under the NOAA courtesy limiter. Source and analysis provenance stay attached to every result.

### GEFS

GEFS uses member-specific NOAA AWS `pgrb2a` objects and `.idx` byte ranges. Immutable selected-message slices are cached locally, then decoded and sampled/derived locally.

Member work is bounded-concurrent. Multi-point and transect operations deliberately reuse upstream member slices rather than multiplying upstream transfer by point count.

## GRIB decoding

The normal npm path uses the bundled GRIB2 decoder supplied by `@mattnucc/gribberish`, so users do **not** need to install native `wgrib2` for CLI or MCP use.

Native `wgrib2` remains an explicit compatibility/debug backend selected through `WGRIB2_PATH` or `WFG_DECODER=wgrib2`. The Docker image includes native `wgrib2` as that reproducible fallback path.

The rest of the codebase is isolated from decoder choice behind a narrow decoding abstraction and works with typed meteorological values rather than raw GRIB internals.

## Public surfaces

### CLI

The CLI is operation-oriented. Where registration is unified, operations use `--model gfs|gefs` and preserve model-specific result schemas.

GEFS also keeps explicit model-native commands where they are clearer or predate the shared dispatcher. In v0.1.0 these include scalar ensemble access, mixed-field bundles, `ensemble-parcel`, and `ensemble-parcel-timeseries`. The shared `diagnostic-timeseries --model gefs` command currently handles layer/profile series, while the explicit parcel-series command exposes the same core parcel time-series capability.

### MCP

MCP intentionally keeps explicit model-named wrappers. This gives agents smaller, less ambiguous schemas while delegating to the same core used by CLI.

`get_gefs_diagnostic_timeseries` supports layer, profile and parcel diagnostic series even though the CLI currently splits parcel series into `ensemble-parcel-timeseries`.

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
