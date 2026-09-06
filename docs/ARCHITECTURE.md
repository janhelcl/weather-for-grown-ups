# Architecture

Weather for Grown Ups is a **numerical-weather-model access and meteorology engine**. It is not a forecast-interpretation layer.

The architectural invariant is:

> **One public atmospheric language; model and provider differences stay explicit behind it.**

```text
CLI / MCP stdio / MCP HTTP
          ↓
public schemas + unified application services
          ↓
operation-specific registries
          ↓
dataset adapters / comparison strategies
          ↓
dataset-native application services
          ↓
source + access + cache + decoder boundaries
          ↓
NOAA / ECMWF / DWD / Météo-France products
```

The core is the product. CLI and MCP are transports over the same application services, not independent implementations.

## Public contract

Normal atmospheric access is organized as:

```text
dataset × geometry × time × selection
```

Public dataset IDs are:

- `gfs`, `aigfs`, `aigefs`, `hgefs`;
- `gefs`;
- `ifs`, `ifs-ens`, `aifs`, `aifs-ens`;
- `icon-d2`, `icon-d2-eps`;
- `arome`, `pe-arome`;
- `gfs-analysis`.

The shared vocabulary does **not** imply identical inventories or result shapes. Unsupported combinations fail at the capability boundary instead of being coerced into fake symmetry.

Historical GFS forecasts are not a second public dataset. An old explicit `forecast.run` keeps `dataset: "gfs"` and resolves to the grid-matched archive. GEFS retrospective forecasts likewise keep `dataset: "gefs"` and use `forecast.kind: "reforecast"` because a reforecast is a different forecast population, not a transport detail.

## Layer boundaries

### `schema/`: public grammar

`src/schema/` defines public request/result contracts.

`unified-api.ts` owns the dataset-agnostic grammar: dataset, geometry, time, selection and shared modifiers. Dataset-specific validation lives behind `dataset-capability-validation.ts`, including:

- run-selector support;
- forecast-versus-analysis semantics;
- GFS grid/source overrides;
- GEFS reforecast constraints;
- ensemble member populations;
- model-specific variable/field/diagnostic inventories.

Adding a dataset must not create a second public query namespace or add model branches to the unified dispatcher.

### `catalog/`: capability truth

`src/catalog/models.ts` is the dataset capability registry. It carries role, deterministic/ensemble kind, provider, model class, spatial domain, native-grid semantics, cadence and forecast horizon.

Variable, field and diagnostic catalogs define canonical IDs, raw dependencies, vertical/temporal semantics and dataset support. `search_catalog` and the CLI catalog read this local metadata; discovery does not probe upstream weather services.

The catalog is descriptive truth. Execution still validates the concrete request before source access.

### Unified application services: validate once, dispatch once

`src/core/unified-atmosphere-api.ts` is the public composition entry point.

- `UnifiedAtmosphereQueryService` normalizes the public query, validates the dataset/domain boundary, dispatches through `core/query-adapters/`, then wraps the result.
- `UnifiedAtmosphereDiagnosticService` does the same through `core/diagnostic-adapters/`.
- run comparison, verification and analog search dispatch through `core/specialized-adapters/`.
- cross-dataset comparison dispatches through `core/comparison-strategies/`.

Unified services do not contain per-model routing switches. The registry chooses the dataset-native implementation.

### Dataset adapters: translate, do not reinterpret

Adapters translate the common request into an existing dataset-native service. They are allowed to choose the correct operation implementation for that dataset and geometry, but they do not redefine the public schema or meteorological meaning.

A useful rule is:

> **Adapters map shared intent to native capability; they never manufacture capability.**

This is especially important for regional models, AI products and historical data where upstream inventories differ materially.

### `core/comparison-strategies/`: explicit scientific comparisons

Cross-dataset comparison has a restrictive strategy registry. Every supported pair declares its alignment and comparison semantics. There is deliberately no generic “same field name, therefore subtract” fallback.

Strategies preserve:

- initialization and valid-time alignment;
- native-grid sampling provenance;
- deterministic-versus-ensemble meaning;
- member-population identity;
- scientifically valid field/pressure intersections.

Independent ensembles are summarized independently. Member labels are never paired across models as if they were trajectories. HGEFS comparisons also retain constituent overlap rather than implying statistical independence.

## Deterministic, ensemble and hybrid semantics

Deterministic datasets normalize one atmospheric state and evaluate shared physics once.

Ensemble datasets normalize **each selected member independently**, evaluate nonlinear diagnostics per member, and only then aggregate. WFG does not calculate CAPE, inversion structure, freezing levels or similar nonlinear quantities from an ensemble-mean profile and present that as member behavior.

`src/core/ensemble-statistics.ts` centralizes mean, population standard deviation, min/max, caller-selected quantiles and raw member threshold fractions. Those fractions are **raw model-member evidence, not calibrated probability**.

HGEFS is an application-level hybrid population: 31 GEFS physics members plus 31 AIGEFS AI members. Constituent identity and native-grid provenance remain visible.

## Shared meteorology boundary

Provider records are normalized before shared physical kernels run. Model-independent derivations live under `derived/` and shared diagnostic services in `core/`.

The shared physics includes, among other things:

- thermodynamic profile derivations;
- environmental lapse rate and potential-temperature gradients;
- vector wind shear;
- freezing-level crossings and inversion structure;
- parcel start-state construction;
- LCL/LFC/EL;
- pseudo-adiabatic parcel paths;
- virtual-temperature buoyancy, CAPE and CIN.

Parcel definitions remain explicit: `surface_2m`, `mixed_layer_100hpa`, and `most_unstable_300hpa`. A dataset advertises parcel diagnostics only when its source inventory can initialize the shared parcel engine.

## Spatial and temporal composition

Larger requests compose bounded primitives while preserving native model semantics.

- Multi-time forecasts pin one initialization that can satisfy the requested range.
- Transects use shared great-circle interpolation and delegate to dataset-native point/multi-point access.
- Area operations aggregate native sampled cells rather than returning unbounded grids.
- Ensemble spatial/temporal operations remain member-first.
- Historical analysis preserves exact 00/06/12/18 UTC analysis cycles and has no forecast initialization/lead axis.

Composition is allowed to be serial or bounded-concurrent according to the source contract. The public result reports what was resolved; it does not pretend every backend has identical reuse or parallelism characteristics.

## Source, access, cache and decoder boundaries

These concerns are separate because changing a transport must not change the atmospheric API.

### `sources/`: provider/product semantics

Source modules own product naming, URLs/object keys, upstream inventories, archive layouts and provider-specific payload decoding into source-neutral records. Source contracts expose provenance rather than leaking provider URLs upward as the domain model.

### `access/`: transport policy

`src/access/` owns provider etiquette: concurrency/pacing, retry/backoff, `Retry-After`, shared user-agent identity and HTTP failure classification.

Provider policies are independent. NOMADS pacing is not inherited by NOAA AWS, NCEI, NCAR/GDEX, IGRA, ECMWF, DWD or Météo-France merely because they all provide weather data.

### `cache/`: immutable reuse

Cache decorators own local immutable artifact reuse. A cache hit bypasses upstream access policy; a cache miss still goes through the provider/source policy. Cache keys represent the product/request identity, not whichever transient URL happened to serve it.

### `grib/`: decoding

The normal npm path uses the bundled `@mattnucc/gribberish` decoder for every dataset. Users do not need native `wgrib2`, CDO or other weather tooling for normal CLI/MCP use.

Native `wgrib2` remains an explicit compatibility/debug backend selected with `WGRIB2_PATH` or `WFG_DECODER=wgrib2`. The Docker image includes it as the reproducible fallback.

## Important routing examples

Routing details belong below the public query language and should be documented here or in the owning dataset document, not copied into every operation page.

### Operational GFS

For normal `gfs` access, source selection is automatic:

- point/profile, time-series, multi-point and transect work uses NOAA AWS Open Data `.idx` byte ranges;
- bounded area work uses NOMADS geographic subsetting;
- explicit `source` is a GFS-only override/debug control where the geometry can honor it.

Old explicit runs preserve the public `gfs` identity and route to the selected grid's historical archive.

### Archived GFS forecasts

- 0.25° archived operational forecasts use NCAR/GDEX d084001 from its supported start date.
- 0.5° Grid 4 forecasts use the same shared Grid 4 routing state machine as `gfs-analysis`: AWS from 2021-01-01, NCEI fileServer for earlier point access, and NCSS for pre-2021 area access or eligible fallback.

The result preserves run, lead, valid time, grid and the provider/access route that actually served the request.

### Historical GFS analysis

`gfs-analysis` is one 0.5° Grid 4 analysis dataset across several transports:

- from 2021-01-01: NOAA AWS Open Data 0.50° `f000` with `.idx` byte-range access;
- 2007–2020 points: NCEI THREDDS fileServer full-file download plus local decode;
- 2007–2020 areas: NCEI NCSS, because fileServer cannot subset;
- AWS/fileServer routes may fall back to NCSS on eligible data/upstream availability failures.

The shared router decides transport by era and operation. Public history semantics do not change when the provider route changes, and provenance reports the route that actually served the request.

### ECMWF

IFS, IFS ENS, AIFS and AIFS ENS preserve ECMWF-native run cadence, horizon, product/member identity and indexed Open Data access. Multi-time operations pin a run capable of satisfying the complete range.

### Regional providers

ICON-D2/ICON-D2-EPS and AROME/PE-AROME keep native-model grid truth separate from public delivery/remap grids. Provider credentials, packaging, remapping, retries and endpoint details remain below the unified dataset boundary.

ICON-D2-EPS remapping is implemented in-process from DWD's official grid/weights artifacts; no native CDO dependency is required. PE-AROME bearer credentials and targeted WCS packaging remain isolated in the source/access layer.

## CLI / MCP parity

The CLI and MCP call the same services and schemas.

CLI atmospheric commands are intentionally compact:

- `catalog`;
- `query`;
- `diagnose`;
- `compare-runs`;
- `compare-datasets`;
- `verify`;
- `analogs`;
- `index ...` for local history/verification corpus administration;
- `mcp` / `mcp-http` as transport launchers.

MCP exposes the corresponding weather surface:

- `search_catalog`;
- `query_atmosphere`;
- `diagnose_atmosphere`;
- `compare_runs`;
- `compare_datasets`;
- `verify_forecast`;
- `find_analogs`.

Index construction/backfill stays CLI-only because it is local administration, not a weather query.

Validation belongs to the application contract, not the transport. CLI and MCP failures are mapped through the same public failure model; MCP only redacts unclassified internal-error text at the remote boundary.

## Dependency rule

The intended dependency direction is:

```text
public transports
  → unified application services
    → adapter / strategy registries
      → dataset-native application services
        → source/cache/decoder interfaces and implementations
          → provider transports
```

Default service constructors may assemble their concrete lower-level dependencies for standalone use, but the behavioral seams remain injectable. Higher layers must not bypass those seams to perform provider HTTP, caching or decoding themselves.

For new work:

- **new dataset:** extend catalog capability + relevant adapters;
- **new comparison:** register an explicit strategy;
- **new provider/backend:** add/change a source/access implementation;
- **new physical derivation:** add it below the dataset adapters and reuse it across compatible datasets;
- **new transport:** call the existing unified services.

## Core does not own

WFG deliberately does not own:

- activity-specific weather scores;
- subjective forecast interpretation;
- route, summit or flight safety decisions;
- turbine/power-production models;
- calibrated probability unless a dedicated calibration layer is explicitly designed and validated.

Those belong to the consuming agent or a specialized application built on top of WFG.
