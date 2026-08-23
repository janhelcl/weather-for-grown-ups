# Architecture

Weather for Grown Ups is primarily a **numerical-weather-model data-access product**, not a forecasting or interpretation layer.

```text
NOAA GFS / GEFS
      ↓
model-specific source adapters and catalogs
      ↓
normalization / query planning / caching
      ↓
deterministic transforms and ensemble summaries
      ↓
shared Zod result contracts
      ↓
CLI / MCP stdio / MCP Streamable HTTP
      ↓
agent interpretation
```

## Core principles

The core owns:

- explicit model identity and product semantics;
- canonical variable/field/member names;
- run, valid-time, forecast-hour and native-cadence semantics;
- authoritative published pressure levels and explicit non-isobaric vertical semantics;
- instantaneous / accumulation / average temporal semantics where applicable;
- query planning and dependency expansion;
- upstream access, pacing and immutable-slice caching;
- GRIB decoder abstraction;
- normalized typed results and provenance;
- deterministic physical transforms, spatial/temporal compositions, and explicit ensemble statistics.

The core is the product. CLI and MCP are adapters over it, not separate implementations.

Model differences stay explicit. GEFS 0.5° does not inherit the deterministic GFS 0.25° catalog or cadence merely because many GRIB codes overlap.

## Deterministic GFS 0.25°

### Catalog-driven derivation

Derived variables declare raw GFS dependencies in the shared catalog. Query planning expands those dependencies before source access, validates raw completeness, and only then computes the requested value locally. This keeps NOAA access minimal and makes the same derivation automatically available to every compatible surface.

Moist thermodynamic variables remain ordinary per-level derived variables. Wet-bulb temperature and equivalent potential temperature both depend on temperature plus specific humidity, with pressure supplied by the isobaric coordinate. Equivalent potential temperature uses the Bolton (1980) formulation. Wet-bulb temperature is a deterministic same-pressure adiabatic-saturation enthalpy solve.

### Vertical diagnostics

Pressure-layer diagnostics explicitly name a lower-altitude/higher-pressure surface and an upper-altitude/lower-pressure surface. One minimal two-level profile supplies the raw endpoints used for environmental lapse rate, vector wind shear, and potential-temperature gradient. Height-normalized quantities use GFS geopotential-height difference rather than treating pressure difference as geometric depth.

Whole-profile diagnostics are explicit about sampling. The caller chooses the published pressure levels. WFG fetches the union of dependencies once, returns those sampled levels, and derives freezing-level crossings or inversion structure locally. It does not imply unresolved vertical structure between pressure levels that were never requested.

Reusable mechanics handle strict height ordering, adjacent gradients, threshold crossings, contiguous matching layers, and extrema. Meteorological diagnostics compose those primitives rather than reimplementing traversal/interpolation behavior independently.

### Parcel diagnostics

Parcel choice is part of the physics, so WFG has no ambiguous generic CAPE tool. Callers explicitly select `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa`.

One profile request obtains pressure-level temperature, specific humidity and geopotential height together with the required surface/2 m fields. The surface parcel initializes from GFS surface pressure/geopotential height with 2 m temperature and humidity. The mixed-layer parcel uses pressure-weighted mean potential temperature and mixing ratio over the exact lowest 100 hPa. The most-unstable parcel selects the sampled state with maximum Bolton equivalent potential temperature in the lowest 300 hPa.

Ascent is dry adiabatic to the Bolton LCL and pseudo-adiabatic above it using deterministic numerical integration in log pressure. Environmental values are interpolated in log pressure. Buoyancy compares parcel and environmental **virtual temperature**; zero-buoyancy crossings are inserted before pressure-coordinate CAPE/CIN integration. Raw environmental levels and the complete parcel path remain in the single-time result for auditability.

### Spatial and temporal composition

`BatchPointsService` is the efficient same-time/multi-location primitive. It resolves one GFS run, downloads/reuses one selected-message AWS slice, then samples all requested coordinates locally.

`TransectService` composes that primitive: it generates evenly spaced great-circle coordinates, delegates one batch request, and attaches along-track distance.

`PointsTimeSeriesService` composes batch requests across native GFS forecast steps, reusing one selected-message slice per step. `TimeSeriesService` is the single-point field equivalent. `RunComparisonService` holds valid time constant and compares consecutive six-hour cycles with deterministic delta rules.

`DiagnosticTimeSeriesService` composes the existing single-time layer, whole-profile, and parcel services across the same native GFS time axis. Query-aware `latest` is resolved once against the complete valid-time range and exact raw dependencies; every step then receives that explicit cycle so a series cannot drift between model runs.

Area summaries deliberately use a different path. A bounded NOMADS subset is decoded locally and reduced to statistics; the raw grid is never returned.

## GEFS 0.5° ensemble foundation

GEFS starts as a separate model contract rather than an option on `ProfileService`.

The initial `GefsEnsembleService` owns one narrow primitive:

```text
point + valid time + raw pgrb2a pressure variable + pressure surface
                          ↓
                  selected GEFS members
                          ↓
       one member-specific AWS GRIB slice each
                          ↓
               local wgrib2 point sample
                          ↓
 normalized members + deterministic distribution summary
```

### Separate catalog

`src/catalog/gefs.ts` declares the supported control/perturbed members and the exact first-slice `pgrb2a` variable/pressure combinations. The schema rejects combinations outside that contract before source access.

This deliberately avoids assuming that deterministic GFS and GEFS publish identical variables, pressure surfaces, resolutions, or time cadences.

### Member-aware source access

`GefsS3SubsetCache` addresses immutable member-specific GEFS objects in NOAA AWS Open Data. It:

1. fetches and caches the member `.idx` inventory;
2. selects the requested GRIB code/pressure message;
3. downloads only that byte range;
4. caches the resulting immutable subset;
5. lets the shared `Wgrib2Decoder` sample it locally.

The cache key includes run, forecast hour, member, GRIB code and pressure level. GEFS therefore shares the decoder boundary with GFS but not the source/catalog semantics.

### GEFS run resolution

`GefsLatestRunResolver` is query-aware over member availability. Starting from the newest six-hour cycle that could precede the requested valid time, it walks older cycles until every selected member has the required forecast file.

The current WFG GEFS contract uses native three-hour output from `f000` through `f384`. Upstream extensions beyond that horizon are not adopted implicitly.

### Ensemble statistics

The first ensemble result returns all selected member values and computes locally:

- arithmetic mean;
- population standard deviation;
- min/max;
- caller-selected quantiles using linear interpolation over sorted members;
- optional fraction of selected members greater than or equal to a threshold.

Threshold fractions are explicitly tagged `raw_member_fraction_not_calibrated_probability`. Calibration, weighting, climatological correction, and decision interpretation are outside this primitive.

This result is intentionally suitable for future composition into GEFS time series, threshold/exceedance tools, ensemble diagnostics, and deterministic-GFS-vs-GEFS comparisons without changing the underlying member/source contract.

## Public surfaces

CLI and MCP are equal public surfaces over the same services and schemas.

The CLI has one Commander root in `src/cli.ts`. Command registration is explicit and grouped under `src/cli/`, including the GEFS-specific `ensemble-command.ts`. Command modules contain presentation and argument adaptation only.

MCP has one `createMcpServer()` factory. Both transports instantiate the same tool set:

- **stdio** for local process-spawned agent clients;
- **Streamable HTTP** for hosted/remote clients.

`get_gefs_ensemble` and `wfg ensemble` both call `GefsEnsembleService`; deterministic GFS tools likewise continue to share their existing services.

The HTTP launcher is transport/infrastructure code only. It adds `/mcp`, `/healthz`, safe loopback defaults, and Host/Origin protection; it does not define a separate atmospheric API.

## Shared contracts

Shared Zod schemas define public deterministic GFS and GEFS query/result shapes. CLI validates results before emission; MCP advertises and validates the same result shapes.

A new core result shape is incomplete until its shared schema and both relevant public adapters are updated and tested.

## Source strategy

### NOMADS Grib Filter

Use NOMADS where geographic subsetting materially reduces transfer: deterministic GFS single-point requests and bounded areas. All physical requests share the same cross-process courtesy limiter and cache boundary.

### NOAA AWS Open Data — deterministic GFS

Use GFS AWS `.idx` inventories and HTTP byte ranges where selected messages can be reused across locations or forecast steps: batch points, transects, field time series, diagnostic time series, multi-point time series, and run comparison.

### NOAA AWS Open Data — GEFS

Use member-specific GEFS AWS `pgrb2a` objects and `.idx` byte ranges. Each requested member contributes its own selected-message slice; member sampling is bounded-concurrent and aggregation happens locally.

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
- calibrated probabilities unless an explicit calibration layer is later designed and validated;
- domain-specific safety judgments.

Those belong to the consuming agent or a specialized application.
