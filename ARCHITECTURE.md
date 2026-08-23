# Architecture

Weather for Grown Ups is primarily a **numerical-weather-model data-access product**, not a forecasting or interpretation layer.

```text
NOAA GFS / GEFS
      ↓
model-specific catalogs, run semantics and source adapters
      ↓
normalized atmospheric states / profile adapters
      ↓
shared meteorological kernels and composition primitives
      ↓
deterministic result OR ensemble member aggregation
      ↓
model-discriminated shared contracts
      ↓
CLI / MCP stdio / MCP Streamable HTTP
      ↓
agent interpretation
```

## Core principles

The core owns:

- explicit model identity, model capabilities and product semantics;
- canonical variable/field/member names;
- run, valid-time, forecast-hour and native-cadence semantics;
- authoritative published pressure levels and explicit non-isobaric vertical semantics;
- instantaneous / accumulation / average temporal semantics where applicable;
- query planning and dependency expansion;
- upstream access, pacing and immutable-slice caching;
- GRIB decoder abstraction;
- normalized typed atmospheric values and provenance;
- model-independent physical transforms;
- spatial/temporal compositions;
- explicit ensemble statistics and aggregation semantics.

The core is the product. CLI and MCP are adapters over it, not separate implementations.

The key rule is:

> **Unify operations and physics; preserve model semantics.**

A common operation does not imply identical source inventory or identical result shape. GFS and GEFS can both implement `profile`, `timeseries`, or `layer_diagnostics`, while deterministic GFS returns one state and GEFS returns a member distribution.

## Model capability boundary

`src/catalog/models.ts` is the explicit capability registry for atmospheric model adapters. It records model kind, grid spacing, forecast horizon and supported operations.

This prevents two bad failure modes:

1. mechanically copying every GFS endpoint into a GEFS namespace even when ensemble semantics should differ;
2. pretending GEFS supports a GFS operation when the required upstream fields are not actually available.

Unsupported capabilities are data in the model catalog, not accidental runtime surprises. Adding a future model such as ICON or ECMWF/AIFS should mean implementing model-specific inventory/source/run adapters behind stable atmospheric operation boundaries rather than creating a new API tree from scratch.

## Normalized pressure-profile boundary

`ProfileLevel` is the normalized pressure-state representation consumed by deterministic meteorology.

`src/core/atmospheric-profile.ts` defines a model-independent `AtmosphericProfileSnapshot` around those levels. Deterministic GFS already naturally produces this shape. GEFS member profiles are adapted into it member-by-member:

```text
GFS raw/profile service ───────────────┐
                                      ├─> normalized ProfileLevel[] ─> shared physics
GEFS ensemble profile ─> member split ┘
```

The adapter maps GEFS normalized raw values such as temperature, U/V wind and geopotential height to the same typed level fields used by deterministic diagnostics. The physical layer therefore does not need to know whether a level originated in GFS or one GEFS member.

This boundary is intentionally below ensemble aggregation. A nonlinear meteorological diagnostic is evaluated on each ensemble member's atmospheric state first; WFG does not calculate diagnostics from the ensemble-mean profile unless a future operation explicitly defines that different quantity.

## Shared diagnostic kernels

Low-level formulas already live under `src/derived/`. `src/core/pressure-diagnostics.ts` now owns model-independent orchestration over normalized pressure levels for:

- environmental temperature lapse rate;
- vector wind shear;
- potential-temperature gradient;
- freezing-level crossings;
- sampled temperature-inversion layers.

The deterministic GFS `LayerDiagnosticsService` and `ProfileDiagnosticsService` call these kernels rather than owning parallel formula/traversal logic.

GEFS layer diagnostics call the **same** layer kernel once per requested member. Because geopotential heights differ between members, physical layer depth is member-specific too. Only after each member's calculation is complete are diagnostic outputs and depth summarized across the ensemble.

Parcel mechanics remain model-independent under `derived/parcel-diagnostics.ts`, but the current GEFS product contract does not yet provide the complete dependency parity needed to expose the GFS parcel operation. The model capability catalog therefore marks parcel diagnostics unsupported for GEFS instead of fabricating parity.

## Shared ensemble statistics

`src/core/ensemble-statistics.ts` is the one distribution implementation used by raw scalar GEFS fields, profile cells and diagnostic outputs.

It defines:

- arithmetic mean;
- population standard deviation;
- min/max;
- caller-selected quantiles using linear interpolation over sorted members;
- raw >= threshold member fractions.

Threshold fractions retain the interpretation marker `raw_member_fraction_not_calibrated_probability`. Calibration, model weighting, climatological correction and decision-specific interpretation remain outside this primitive.

Centralizing these mechanics ensures that “p50” or “population spread” means the same thing whether the distribution contains raw temperature, wind shear, layer depth, or another future member-derived quantity.

## Unified operation dispatch

The canonical internal operation contracts are model-discriminated unions rather than flattened result objects.

Examples:

```text
AtmosphericProfileRequest
  ├─ model=gfs_0p25  + GFS profile query
  └─ model=gefs_0p50 + GEFS ensemble-profile query

AtmosphericProfileResult
  ├─ deterministic GFS profile
  └─ GEFS profile distributions/member data
```

Equivalent dispatch boundaries exist for time series and layer diagnostics.

Services:

- `AtmosphericProfileService`
- `AtmosphericTimeSeriesService`
- `AtmosphericLayerDiagnosticsService`

select the model adapter and validate the returned model-specific schema. They intentionally do **not** coerce results into a lowest-common-denominator `value` object.

## Deterministic GFS 0.25°

### Catalog-driven derivation

Derived variables declare raw GFS dependencies in the shared catalog. Query planning expands those dependencies before source access, validates raw completeness, and only then computes the requested value locally. This keeps NOAA access minimal and makes the same derivation automatically available to every compatible GFS composition.

Moist thermodynamic variables remain ordinary per-level derived variables. Wet-bulb temperature and equivalent potential temperature both depend on temperature plus specific humidity, with pressure supplied by the isobaric coordinate. Equivalent potential temperature uses the Bolton (1980) formulation. Wet-bulb temperature is a deterministic same-pressure adiabatic-saturation enthalpy solve.

### Vertical diagnostics

Pressure-layer diagnostics explicitly name a lower-altitude/higher-pressure surface and an upper-altitude/lower-pressure surface. One minimal two-level profile supplies endpoints. Height-normalized quantities use geopotential-height difference rather than treating pressure difference as geometric depth.

Whole-profile diagnostics are explicit about sampling. The caller chooses published pressure levels. WFG fetches the dependency union once, returns sampled levels, and derives freezing-level crossings or inversion structure locally. It does not imply unresolved vertical structure between pressure levels never requested.

### Parcel diagnostics

Parcel choice is part of the physics, so WFG has no ambiguous generic CAPE tool. Callers explicitly select `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa`.

One profile request obtains pressure-level temperature, specific humidity and geopotential height together with required surface/2 m fields. The surface parcel initializes from GFS surface pressure/geopotential height with 2 m temperature and humidity. The mixed-layer parcel uses pressure-weighted mean potential temperature and mixing ratio over the exact lowest 100 hPa. The most-unstable parcel selects the sampled state with maximum Bolton equivalent potential temperature in the lowest 300 hPa.

Ascent is dry adiabatic to the Bolton LCL and pseudo-adiabatic above it using deterministic numerical integration in log pressure. Environmental values are interpolated in log pressure. Buoyancy compares parcel and environmental **virtual temperature**; zero-buoyancy crossings are inserted before pressure-coordinate CAPE/CIN integration. Raw environmental levels and the complete parcel path remain in the single-time result for auditability.

### Spatial and temporal composition

`BatchPointsService` is the efficient same-time/multi-location primitive. It resolves one GFS run, downloads/reuses one selected-message AWS slice, then samples all requested coordinates locally.

`TransectService` composes that primitive: it generates evenly spaced great-circle coordinates, delegates one batch request, and attaches along-track distance.

`PointsTimeSeriesService` composes batch requests across native GFS forecast steps, reusing one selected-message slice per step. `TimeSeriesService` is the single-point field equivalent. `RunComparisonService` holds valid time constant and compares consecutive six-hour cycles with deterministic delta rules.

`DiagnosticTimeSeriesService` composes existing single-time layer, whole-profile and parcel services across the native GFS time axis. Query-aware `latest` is resolved once against the complete valid-time range and exact raw dependencies; every step then receives that explicit cycle so a series cannot drift between runs.

Area summaries deliberately use a different path. A bounded NOMADS subset is decoded locally and reduced to statistics; the raw grid is never returned.

## GEFS 0.5° ensemble foundation

GEFS remains a separate **model adapter**, not a boolean/member option inside GFS source code.

### Separate inventory and run semantics

`src/catalog/gefs.ts` declares supported control/perturbed members and the current `pgrb2a` variable/pressure combinations. GEFS schemas validate the requested Cartesian selection before source access.

`GefsLatestRunResolver` is query-aware over member availability. Starting from the newest six-hour cycle that could precede the requested valid time, it walks older cycles until every selected member has the required forecast file. Range resolution fixes one cycle across complete ensemble time-series intervals.

The current WFG GEFS contract uses native three-hour output from `f000` through `f384`. Upstream changes/extensions are adopted only by explicit contract changes and tests.

### Member-aware source access

`GefsS3SubsetCache` addresses immutable member-specific GEFS objects in NOAA AWS Open Data. For profile/diagnostic selections it:

1. fetches and caches the member `.idx` inventory;
2. selects all requested GRIB variable/pressure messages;
3. downloads only those byte ranges;
4. stitches and caches one immutable multi-message subset for that selection/member;
5. decodes the point once with the shared `Wgrib2Decoder`.

Range downloads are bounded within each member and member processing itself is bounded-concurrent. Repeated operations naturally reuse immutable profile slices.

### Ensemble profile and diagnostics

`GefsEnsembleProfileService` produces raw normalized member profiles plus cell-wise distributions. Member profiles are omitted from public responses by default but can be requested for audit/composition.

`GefsLayerDiagnosticsService` is an example of the intended ensemble composition pattern:

```text
requested layer diagnostic
        ↓
expand shared diagnostic dependencies
        ↓
fetch one GEFS profile slice per member
        ↓
adapt each member to normalized ProfileLevel[]
        ↓
run same pressure-diagnostic kernel per member
        ↓
summarize member diagnostic outputs and layer depths
```

This is the template for future ensemble diagnostics.

## Public surfaces

CLI and MCP remain equal public surfaces over the same core, but they optimize for different callers.

### CLI

The CLI is operation-oriented. Shared operations use `--model gfs|gefs`:

- `profile`
- `timeseries`
- `layer`

GFS remains the default model for backward compatibility. Existing `ensemble-profile` and `ensemble-timeseries` commands remain explicit GEFS aliases but route through the same unified dispatchers rather than separate business logic.

Other commands remain model-specific until the capability registry says otherwise.

### MCP

MCP intentionally retains explicit wrappers such as:

- `get_gfs_profile`
- `get_gefs_ensemble_profile`
- `get_gfs_layer_diagnostics`
- `get_gefs_layer_diagnostics`

This keeps schemas small and obvious for agents, especially smaller models, while those wrappers delegate to shared underlying profile/diagnostic primitives. A unified core does not require one giant polymorphic MCP tool.

Both MCP transports instantiate the same tool set:

- **stdio** for local process-spawned clients;
- **Streamable HTTP** for hosted/remote clients.

The HTTP launcher is transport/infrastructure code only. It adds `/mcp`, `/healthz`, safe loopback defaults and Host/Origin protection; it does not define a separate atmospheric API.

## Shared contracts

Zod schemas define public query/result shapes. Shared operation schemas are discriminated unions over model-specific schemas, preserving exact semantics and validation rules for each model.

A new model or operation is incomplete until:

1. capability metadata is correct;
2. model-specific inventory/source/run validation exists;
3. normalized state adaptation is defined where physical kernels are reused;
4. result semantics are explicit;
5. CLI and MCP adapters are updated where the operation is public;
6. deterministic tests and appropriate real-upstream smoke coverage exist.

## Source strategy

### NOMADS Grib Filter

Use NOMADS where geographic subsetting materially reduces transfer: deterministic GFS single-point requests and bounded areas. All physical requests share the same cross-process courtesy limiter and cache boundary.

### NOAA AWS Open Data — deterministic GFS

Use GFS AWS `.idx` inventories and HTTP byte ranges where selected messages can be reused across locations or forecast steps: batch points, transects, field time series, diagnostic time series, multi-point time series, run comparison and aligned GFS-vs-GEFS work.

### NOAA AWS Open Data — GEFS

Use member-specific GEFS AWS `pgrb2a` objects and `.idx` byte ranges. Each requested member contributes a selected-message slice; sampling/diagnostics are bounded-concurrent and aggregation happens locally.

AWS paths do not use the NOMADS courtesy limiter because they do not call the NOMADS scripted-filter service.

## GRIB strategy

WFG does not implement a GRIB2 parser in TypeScript. `Wgrib2Decoder` is a narrow adapter around NOAA's `wgrib2` executable. GFS and GEFS source layers produce minimal GRIB subsets; the rest of the codebase deals with typed meteorological values rather than GRIB internals.

Docker is therefore the reproducible distribution boundary: the production image pins Node.js and `wgrib2`; the npm package remains lightweight for environments that already provide the decoder.

## Rate limiting

Every physical NOMADS request goes through `FileRateLimiter`. An atomically-created lock directory coordinates independent CLI and MCP processes on one machine. The completion timestamp is persisted separately, making the default 11-second cooldown apply across process lifetimes.

A future hosted multi-replica deployment can replace this implementation with Redis/Postgres behind the same limiter boundary without changing meteorological services.

## Core does not own

- activity-specific weather scores;
- subjective forecast interpretation;
- calibrated probabilities unless an explicit calibration layer is designed and validated;
- domain-specific safety judgments.

Those belong to the consuming agent or a specialized application.
