# Architecture

Weather for Grown Ups is primarily a **numerical-weather-model access and meteorology product**, not a forecast interpretation layer.

```text
NOAA GFS / AIGFS / GEFS / AIGEFS / HGEFS
DWD ICON-D2 / ICON-D2-EPS
Météo-France AROME
ECMWF IFS / AIFS / IFS ENS / AIFS ENS / NCEI historical GFS
      ↓
dataset-specific catalogs, model metadata, time semantics and source adapters
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

A common operation does not imply a common source inventory or a flattened result shape. GFS, AIGFS, IFS and AIFS return deterministic forecast states. Historical Grid 4 returns deterministic analyzed states. GEFS, AIGEFS, IFS ENS and AIFS ENS return member-derived forecast distributions. HGEFS is explicitly hybrid: it pools GEFS physics members with AIGEFS AI members while retaining constituent identity and provenance.

The engine is organized around **operation × dataset** internally, while the public contract is intentionally organized around one query language: `dataset × geometry × time × selection`. Dataset-specific schemas, source adapters and services are implementation details behind that boundary; adding a model must extend the shared vocabulary and capability registry rather than create another public query namespace.

Nonlinear diagnostics are evaluated independently on every ensemble member before aggregation, including both constituent populations inside HGEFS. WFG does not calculate CAPE, lapse rate, inversion structure or another nonlinear quantity from an ensemble-mean profile and pretend it represents the members.

## Layer boundaries

The implementation is split by responsibility rather than by whichever dataset was added first:

- `schema/` defines the public query vocabulary and result contracts. The shared `unified-api.ts` owns only common grammar and dataset-agnostic geometry/time rules; all dataset-sensitive modifier checks—including run-selector support, forecast-vs-analysis semantics, GFS source/grid overrides, GEFS reforecast constraints, and AI/hybrid inventory limits—live in `dataset-capability-validation.ts` behind a validator boundary. Adding a dataset or backend must not add routing branches to the shared schema.
- `core/query-adapters/`, `core/diagnostic-adapters/`, and `core/specialized-adapters/` translate the common vocabulary into dataset-native application services. Public unified services validate once, dispatch through an operation-specific adapter registry, and wrap the result; they do not contain model-specific routing branches. Run comparison, verification, and analog search use the same rule rather than being exceptions.
- `core/comparison-strategies/` is the dedicated semantic boundary for cross-dataset comparison. The registry is restrictive and the implementations are split by responsibility: pair-native strategies preserve established GFS/GEFS/IFS semantics, while normalized model-class strategies cover AI/hybrid families through one shared comparison service. `core/comparison-result-reader.ts` contains the heterogeneous unified-result normalization needed by those strategies so query orchestration does not accumulate dataset result-shape parsing. Every registered strategy declares the supported dataset pair, run and valid-time alignment, variable compatibility, comparison meaning, output shape and provenance shape. There is deliberately no universal fallback strategy.
- `core/` owns meteorological/application composition: profiles, time series, spatial composition, diagnostic kernels, comparisons and archive services.
- `sources/` owns provider/product semantics: URLs, object naming, upstream inventories, archive endpoints and ECMWF mirror selection.
- `access/` owns transport policy: provider concurrency/pacing and retry/backoff. Cache code and meteorology code do not invent their own provider etiquette.
- `cache/` owns local immutable artifact reuse for expensive upstream products. Cache hits must bypass upstream access policy; cache misses still pass through the source/provider policy.
- `grib/` owns decoding and byte/index interpretation.
- `derived/` owns model-independent physical transformations.
- `cli/` and MCP are presentation/transport adapters over the same schemas and application services.

The dependency direction is intentionally inward: public surfaces depend on the single `core/unified-atmosphere-api.ts` composition entry; unified services depend on operation-specific adapter or comparison-strategy registries; adapters/strategies depend on dataset-native core services; core services depend on source/cache/decoder abstractions. Provider policy does not depend on meteorology, and meteorological kernels do not depend on provider transport.

A practical rule for new datasets is: **add capabilities to the catalog and the relevant operation adapters; do not add a new public namespace or dataset branch to a unified dispatcher.** A practical rule for new comparisons is: **register an explicit scientifically meaningful strategy; never fall back to generic subtraction just because two datasets share field names.** A practical rule for new upstream backends is: **add or change a source/access implementation; do not change the public query language.**

## Atmospheric dataset capability boundary

`src/catalog/models.ts` is the explicit atmospheric **dataset** capability registry. The registry uses explicit internal dataset IDs; public CLI/MCP callers use the short dataset IDs `gfs`, `aigfs`, `aigefs`, `hgefs`, `icon-d2`, `icon-d2-eps`, `arome`, `gefs`, `ifs`, `aifs`, `aifs-ens`, `ifs-ens`, and `gfs-analysis`. Public metadata is derived from this registry so role/kind semantics cannot drift into a second source of truth.

| Dataset | Model class | Result kind | Shared query/diagnostic role | Run comparison | Registered dataset comparisons |
| --- | --- | --- | --- | --- | --- |
| GFS | physics | deterministic | Full deterministic atmospheric surface, including parcel diagnostics | ✅ | GEFS, IFS, AIGFS |
| AIGFS | AI | deterministic | Shared deterministic query surface; layer/profile diagnostics where inventory supports them | — | GFS, AIFS |
| GEFS | physics | ensemble | Member-first ensemble atmospheric surface and nonlinear diagnostics | ✅ distribution shift | GFS, IFS ENS, AIGEFS; HGEFS constituent view |
| AIGEFS | AI | ensemble | Member-first AI ensemble surface; layer/profile diagnostics where inventory supports them | — | GEFS; HGEFS constituent view |
| HGEFS | hybrid | ensemble | Application-level GEFS + AIGEFS member composition with constituent provenance | — | GEFS, AIGEFS |
| ICON-D2 | physics | deterministic | Limited-area convection-permitting query surface with pressure/field operations and diagnostics where inventory supports them | — | — |
| ICON-D2-EPS | physics | ensemble | 20-member limited-area member-first convection-permitting surface | — | — |
| AROME | physics | deterministic | Limited-area field-only surface on the explicit 0.01° EURW1S100 public product | — | — |
| IFS | physics | deterministic | Full deterministic ECMWF atmospheric surface, including parcel diagnostics | ✅ | GFS, IFS ENS, AIFS |
| AIFS | AI | deterministic | Shared deterministic query surface; layer/profile diagnostics where inventory supports them | — | IFS, AIGFS |
| IFS ENS | physics | ensemble | Member-first ECMWF ensemble surface and nonlinear diagnostics | ✅ distribution shift | GEFS, IFS, AIFS ENS |
| AIFS ENS | AI | ensemble | Native 51-member AI ensemble surface; layer/profile diagnostics where inventory supports them | — | IFS ENS |
| GFS analysis | physics | deterministic analysis | Shared historical analysis surface and diagnostics | — | Verification/analog workflows are separate |

The capability registry describes the shared **core operation** behind the compact public vocabulary. Historical analog search and archived forecast verification remain specialized composition primitives, while index build/backfill is CLI-only administration rather than a normal atmospheric query.

It also prevents two failure modes: mechanically copying deterministic behavior into an ensemble namespace, and claiming a model supports an operation whose required source fields or semantics are not actually implemented.

### Spatial domain and native-grid capability

Regional NWP uses the same dataset capability boundary rather than adding a regional query namespace. Every atmospheric dataset declares:

- a `spatialDomain`: global or a named limited-area domain with conservative geographic bounds;
- a `nativeGrid`: grid type plus nominal resolution, with `mixed` available when one logical dataset genuinely combines different constituent grids;
- its forecast horizon where applicable;
- the set of native output cadences callers can encounter.

`horizontalGridDegrees` remains compatibility metadata for regular latitude/longitude products; it is deliberately optional so future rotated, icosahedral or Lambert-conformal regional grids are not forced into a degree-grid fiction. HGEFS already exercises the truthful mixed-grid representation by retaining its GEFS 0.5° and AIGEFS 0.25° constituent grids separately.

Catalog discovery consumes this registry directly. Callers can filter by global versus limited-area scope or ask which datasets fully cover a point or bounded area, while normal field/diagnostic filters continue to use the same canonical catalog. Discovery is local and does not probe upstream weather services.

Execution uses the same declaration before operation adapters run. Query and diagnostic services reject geometry outside a dataset's declared domain with `AtmosphericOutOfDomainError` and stable code `OUT_OF_DOMAIN`. This keeps spatial-coverage failure distinct from unsupported selections, unavailable runs, and source-access failures, while provider-specific source details stay below the public schema.

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

Deterministic datasets evaluate these once on their normalized state. Ensemble datasets evaluate supported kernels independently for each member and summarize only after those calculations are complete. HGEFS follows the same rule independently across its GEFS and AIGEFS populations before pooling the hybrid distribution.

Parcel definitions remain explicit: `surface_2m`, `mixed_layer_100hpa`, and `most_unstable_300hpa`. Datasets advertise parcel diagnostics only when their native inventory can initialize the shared parcel kernel; AIGFS, AIGEFS, AIFS, AIFS ENS and HGEFS currently keep that boundary explicit rather than synthesizing missing state.

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

### HGEFS

HGEFS is an application-level **hybrid composition**, not another download stack. The canonical member population is `gefs:c00..p30` plus `aigefs:c00..p30`. The service pins one common cycle, executes each constituent through its existing member-first implementation, then pools only meteorologically compatible normalized outputs. Constituent-native grids remain visible: pressure-level GEFS member access can be 0.5° while AIGEFS is 0.25°, so HGEFS never fabricates one common sampled grid point.

### IFS

Deterministic IFS uses the same public geometry/time vocabulary while preserving ECMWF-native cadence, fixed 0.25° model semantics and selected-message cache reuse. Multi-time operations pin one initialization capable of satisfying the complete range; point, multi-point, transect, area, diagnostics and run comparison all stay deterministic.

### IFS ENS

IFS ENS composition is **member-first** across the 50 perturbed members `p01`–`p50`. Point, multi-point, time-series, transect, area and diagnostic operations evaluate each requested member independently before aggregation. Run comparison compares independently summarized distributions across cycles; it does not pair perturbation labels as trajectories. The deterministic post-Cycle-50r1 unperturbed control remains the separate `ifs` dataset.

## Catalogs and source contracts

GFS, AIGFS, AIGEFS, GEFS, ICON-D2, ICON-D2-EPS, AROME, IFS, AIFS, AIFS ENS, IFS ENS and historical GFS analysis keep dataset-specific source inventories because their upstream products are not identical. HGEFS deliberately has no duplicate member-source stack: it composes the GEFS and AIGEFS source-backed member services. Canonical field IDs and shared physical derivations converge where the quantity is genuinely comparable; unavailable fields remain explicit capability differences rather than being fabricated for symmetry.

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

GFS, AIGFS, AIGEFS, HGEFS, GEFS, deterministic IFS and IFS ENS use explicit 00/06/12/18Z initialization cycles. Multi-time operations resolve one cycle capable of satisfying the complete requested range and then keep that cycle fixed. GFS grid selection is orthogonal to run selection: `0p25` is the default and `0p50` is explicit. An old explicit run keeps the public `gfs` identity and routes to the matching historical forecast archive rather than changing datasets.

ECMWF Open Data preserves different deterministic and ensemble horizons. Deterministic `ifs` uses `oper/fc`: 00/12Z runs publish 3-hourly through `f144`, then 6-hourly through `f240`; 06/18Z runs publish 3-hourly through `f90`. `ifs-ens` uses perturbed `enfo/ef`: 00/12Z runs publish 3-hourly through `f144`, then 6-hourly through `f360`; 06/18Z runs publish 3-hourly through `f144`. `latest` is resolved against the requested field inventory so partially published cycles are not mistaken for selection-capable runs.

GEFS uses control `c00` plus `p01`–`p30` on a native three-hour cadence through `f384`. Pressure-level and mixed pressure/field operations use `pgrb2a` 0.5°. Field-only operations select `pgrb2s` 0.25° through `f240`, then fall back to `pgrb2a` 0.5°. Multi-time field operations choose one product from the complete range and keep that grid fixed.

Historical Grid 4 analysis has no forecast initialization/lead axis: its native time coordinate is the exact 00/06/12/18 UTC analysis cycle. Shared operation dispatch preserves that distinction instead of synthesizing run or forecast-hour fields.

Aligned dataset comparisons resolve one initialization cycle that can satisfy both sides at the requested valid time. The restrictive strategy registry now covers deterministic↔deterministic, deterministic↔ensemble, ensemble↔ensemble and hybrid↔constituent families across physics and AI datasets. Independent ensemble comparisons summarize each population separately without member pairing; HGEFS constituent comparisons explicitly retain the overlap between the constituent and hybrid distributions rather than implying statistical independence.

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

Normal access is `dataset × geometry × time × selection`. Public dataset IDs are `gfs`, `aigfs`, `aigefs`, `hgefs`, `gefs`, `ifs`, `aifs`, `aifs-ens`, `ifs-ens`, and `gfs-analysis`; they map to the explicit internal dataset registry. Dataset-native result semantics remain unchanged.

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

The first three are the normal atmospheric query language. Comparison, verification and analog search remain separate because they are genuine composition operations rather than another geometry/time shape. Dataset comparison is itself registry-driven and restrictive: a shared atmospheric vocabulary does not imply that every pair has a scientifically meaningful comparison strategy. Physics, AI and hybrid pairs declare alignment, comparison semantics, output shape and provenance explicitly; there is no universal subtraction fallback.

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
