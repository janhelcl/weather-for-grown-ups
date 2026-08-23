# Architecture

Weather for Grown Ups is primarily a **data-access product**, not a forecasting or interpretation layer.

```text
NOAA GFS
   ↓
source adapters (NOMADS / AWS Open Data)
   ↓
normalization / query planning / caching
   ↓
deterministic physical derivations and compositions
   ↓
shared Zod result contracts
   ↓
CLI / MCP stdio / MCP Streamable HTTP
   ↓
agent interpretation
```

## Core owns

- canonical variable and field names;
- run / valid-time / forecast-hour semantics;
- authoritative published pressure levels and explicit non-isobaric vertical semantics;
- instantaneous / accumulation / average temporal semantics;
- query planning and dependency expansion;
- upstream pacing and immutable-slice caching;
- GRIB decoder abstraction;
- normalized typed results and provenance;
- deterministic transforms and spatial/temporal compositions.

The core is the product. CLI and MCP are adapters over it, not separate implementations.

## Catalog-driven derivation

Derived variables declare raw GFS dependencies in the shared catalog. Query planning expands those dependencies before source access, validates raw completeness, and only then computes the requested value locally. This keeps NOAA access minimal and makes the same derivation automatically available to every compatible surface.

Moist thermodynamic variables remain ordinary per-level derived variables. Wet-bulb temperature and equivalent potential temperature both depend on temperature plus specific humidity, with pressure supplied by the isobaric coordinate. Equivalent potential temperature uses the Bolton (1980) formulation. Wet-bulb temperature is a deterministic same-pressure adiabatic-saturation enthalpy solve.

## Vertical diagnostics

Pressure-layer diagnostics explicitly name a lower-altitude/higher-pressure surface and an upper-altitude/lower-pressure surface. One minimal two-level profile supplies the raw endpoints used for environmental lapse rate, vector wind shear, and potential-temperature gradient. Height-normalized quantities use GFS geopotential-height difference rather than treating pressure difference as geometric depth.

Whole-profile diagnostics are explicit about sampling. The caller chooses the published pressure levels. WFG fetches the union of dependencies once, returns those sampled levels, and derives freezing-level crossings or inversion structure locally. It does not imply unresolved vertical structure between pressure levels that were never requested.

Reusable mechanics below named diagnostics handle strict height ordering, adjacent gradients, threshold crossings, contiguous matching layers, and extrema. Meteorological diagnostics compose those primitives rather than reimplementing traversal/interpolation behavior independently.

## Parcel diagnostics

Parcel choice is part of the physics, so WFG has no ambiguous generic CAPE tool. Callers explicitly select `surface_2m`, `mixed_layer_100hpa`, or `most_unstable_300hpa`.

One profile request obtains pressure-level temperature, specific humidity and geopotential height together with the required surface/2 m fields. The surface parcel initializes from GFS surface pressure/geopotential height with 2 m temperature and humidity. The mixed-layer parcel uses pressure-weighted mean potential temperature and mixing ratio over the exact lowest 100 hPa. The most-unstable parcel selects the sampled state with maximum Bolton equivalent potential temperature in the lowest 300 hPa.

Ascent is dry adiabatic to the Bolton LCL and pseudo-adiabatic above it using deterministic numerical integration in log pressure. Environmental values are interpolated in log pressure. Buoyancy compares parcel and environmental **virtual temperature**; zero-buoyancy crossings are inserted before the pressure-coordinate CAPE/CIN integration. Raw environmental levels and the complete parcel path remain in the result for auditability.

## Spatial and temporal composition

`BatchPointsService` is the efficient same-time/multi-location primitive. It resolves one run, downloads/reuses one selected-message AWS slice, then samples all requested coordinates locally.

`TransectService` composes that primitive: it generates evenly spaced great-circle coordinates, delegates one batch request, and attaches along-track distance. It does not implement a second GRIB access path.

`PointsTimeSeriesService` composes batch requests across native GFS forecast steps, reusing one selected-message slice per step. `TimeSeriesService` is the single-point equivalent. `RunComparisonService` holds valid time constant and compares consecutive six-hour cycles with deterministic delta rules.

Area summaries deliberately use a different path. A bounded NOMADS subset is decoded locally and reduced to statistics; the raw grid is never returned. Optional percentiles, threshold fractions, and extrema locations operate over defined grid cells in normalized WFG output units.

## Public surfaces

CLI and MCP are equal public surfaces over the same services and schemas.

The CLI has one Commander root in `src/cli.ts`. Command registration is explicit and grouped under `src/cli/`:

- `catalog-command.ts`;
- `point-commands.ts`;
- `diagnostic-commands.ts`;
- `transect-command.ts`;
- `area-command.ts`;
- `shared.ts` for CLI-only parsing/defaults.

Command modules contain presentation and argument adaptation only. Meteorological/data-access logic stays in `src/core/`.

MCP has one `createMcpServer()` factory. Both transports instantiate the same tool set:

- **stdio** for local process-spawned agent clients;
- **Streamable HTTP** for hosted/remote clients.

The HTTP launcher is transport/infrastructure code only. It adds the `/mcp` endpoint, `/healthz`, safe loopback defaults, and Host/Origin protection; it does not define a separate atmospheric API.

## Shared contracts

Shared Zod schemas define public profile, diagnostic, batch, transect, time-series, run-comparison, area-summary, latest-run, vertical, temporal, and provenance contracts. CLI validates results before emission; MCP advertises and validates the same result shapes.

A new core result shape is incomplete until its shared schema and both relevant surface adapters are updated and tested.

## Source strategy

### NOMADS Grib Filter

Use NOMADS where geographic subsetting materially reduces transfer: single-point requests and bounded areas. All physical requests share the same cross-process courtesy limiter and cache boundary.

### NOAA AWS Open Data

Use AWS `.idx` inventories and HTTP byte ranges where one selected GRIB-message slice can be reused across locations or forecast steps: batch points, transects, time series, multi-point time series, and run comparison.

Both paths feed the same `wgrib2` decoder boundary and normalized output contracts.

## GRIB strategy

WFG does not implement a GRIB2 parser in TypeScript. `Wgrib2Decoder` is a narrow adapter around NOAA's `wgrib2` executable. The rest of the codebase deals with typed meteorological values, not GRIB internals.

Docker is therefore the reproducible distribution boundary: the production image pins Node.js and `wgrib2`; the npm package remains lightweight for environments that already provide the decoder.

## Rate limiting

Every physical NOMADS request goes through `FileRateLimiter`. An atomically-created lock directory coordinates independent CLI and MCP processes on one machine. The completion timestamp is persisted separately, making the default 11-second cooldown apply across process lifetimes.

A future hosted multi-replica deployment can replace this implementation with Redis/Postgres behind the same limiter boundary without changing meteorological services.

## Core does not own

- activity-specific weather scores;
- subjective forecast interpretation;
- domain-specific safety judgments.

Those belong to the consuming agent or a specialized application.
