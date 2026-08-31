# Roadmap

Weather for Grown Ups grows by adding **new model semantics behind the same query language**, not by multiplying public APIs.

The standing architectural rule remains:

> **One query language over weather datasets. Native model semantics stay intact.**

The next development line extends WFG across a new model-class axis: physics-based, AI-based and hybrid numerical weather prediction.

## Current foundation

WFG already exposes:

- NOAA GFS, AIGFS, AIGEFS and GEFS;
- ECMWF IFS and IFS ENS;
- archived GFS forecasts, historical GFS analysis and GEFSv12 reforecasts;
- deterministic and member-first ensemble semantics;
- one public query/diagnostic vocabulary across point, points, time range, transect, area and profile operations;
- run comparison, cross-dataset comparison, verification and analog search;
- equal CLI and MCP surfaces over the same application core.

The roadmap below should preserve those boundaries rather than creating model-specific public namespaces.

## Next major capability line

### 1. AIGFS — implemented

NOAA AIGFS is now the first AI forecast dataset.

Goals:

- reuse the existing NOAA/GRIB/access layers where the upstream product permits;
- normalize AIGFS into the same atmospheric state and field vocabulary used by GFS/IFS;
- expose only capabilities supported by the real AIGFS inventory and cadence;
- make model class explicit in dataset metadata instead of encoding AI behavior in ad-hoc branches.

AIGFS is the first test that WFG can change the forecasting machinery without changing the atmospheric question.

### 2. AIFS — **implemented**

ECMWF AIFS Single is now a first-class `aifs` dataset behind the shared query/diagnostic surfaces.

Goals:

- prove the AI-model abstraction across a second provider;
- reuse ECMWF Open Data access and source-policy layers where appropriate;
- avoid any AIGFS-specific concept leaking into the public API;
- preserve AIFS-native run, cadence, grid, field and provenance semantics.

Implemented scope includes point/range/multi-point/transect/area queries plus layer/profile diagnostics over ECMWF Open Data. Parcel diagnostics remain an explicit capability boundary rather than a compatibility shim.

Together, AIGFS and AIFS establish a clean provider-independent AI forecast axis.

### 3. AI ensembles and hybrid ensemble

Add the corresponding ensemble/hybrid products:

- NOAA AIGEFS — **implemented**;
- ECMWF AIFS ENS — **implemented**;
- NOAA HGEFS hybrid ensemble — **implemented**.

Ensemble meteorology remains **member first**. Nonlinear diagnostics are evaluated within each member before aggregation.

AIFS ENS now exposes its native 51-member stochastic population (`c00,p01..p50`) over ECMWF Open Data. Its dedicated control remains distinct from AIFS Single, and control/perturbed `cf`/`pf` packaging is hidden behind the same public ensemble query language without erasing provenance.

Hybrid semantics are explicit. HGEFS is implemented as a 62-member composition of 31 GEFS physics members and 31 AIGEFS AI members. Public member IDs are population-qualified (`gefs:...`, `aigefs:...`), nonlinear diagnostics remain member first, and results preserve constituent-native grid/source provenance rather than inventing one homogeneous member population.

The dedicated upstream HGEFS statistics feed is not treated as a second source of individual members. WFG composes the existing GEFS/AIGEFS member implementations and restricts selections to their scientifically compatible inventory intersection.

## Model-class metadata

Before or during the AI-dataset work, make model class a first-class property of the dataset registry.

Conceptually:

```ts
modelClass: "physics" | "ai" | "hybrid";
resultKind: "deterministic" | "ensemble";
provider: "noaa" | "ecmwf";
```

These are descriptive/capability metadata, not new public query dimensions. Normal access remains:

```text
dataset × geometry × time × selection
```

## Comparison architecture

**Strategy-registry foundation — implemented.** The existing public `compare_datasets` operation now dispatches through a restrictive comparison-strategy registry rather than treating cross-dataset comparison as a generic specialized adapter. The migrated strategies are GFS ↔ GEFS, GFS ↔ IFS, GEFS ↔ IFS ENS, and IFS ↔ IFS ENS.

The registry derives model class, result kind and provider from the dataset catalog, and every strategy explicitly declares run/valid-time alignment, variable compatibility, comparison semantics, output shape and provenance shape. There is no universal fallback strategy.

**AI and hybrid comparison families — implemented.** The AI expansion now uses the same restrictive strategy registry; no unclassified pair routing was added.

Each comparison strategy behind the existing public `compare_datasets` operation declares, at minimum:

- which dataset/population pairs it supports;
- compatible deterministic/ensemble/hybrid result kinds;
- run and valid-time alignment rules;
- variable/diagnostic compatibility;
- comparison semantics;
- output/provenance shape.

Expected strategy classes include:

- deterministic ↔ deterministic deltas;
- deterministic ↔ ensemble positioning;
- ensemble ↔ ensemble distribution shifts;
- physics ↔ AI comparisons;
- hybrid ↔ constituent-population comparisons where scientifically meaningful.

The registry should be **restrictive rather than universal**. Two datasets being queryable through the same atmospheric vocabulary does not imply that every pair has a scientifically meaningful comparison.

Implemented comparison families now include:

- GFS ↔ GEFS and IFS ↔ IFS ENS deterministic-to-ensemble positioning;
- GFS ↔ IFS, GFS ↔ AIGFS, IFS ↔ AIFS and AIGFS ↔ AIFS deterministic deltas;
- GEFS ↔ IFS ENS, GEFS ↔ AIGEFS and IFS ENS ↔ AIFS ENS distribution shifts;
- HGEFS ↔ GEFS and HGEFS ↔ AIGEFS hybrid-to-constituent distribution shifts.

IFS ENS and AIFS ENS retain their native populations rather than being forced into synthetic symmetry. HGEFS comparisons explicitly describe the constituent population as overlapping the hybrid distribution, so the two sides are not presented as statistically independent.

This completes the AI/hybrid model-and-comparison line of the roadmap without weakening the registry's restrictive compatibility rules.

## Target conceptual matrix

```text
                         deterministic        ensemble
NOAA physics             GFS                  GEFS
NOAA AI                  AIGFS                AIGEFS
ECMWF physics            IFS                  IFS ENS
ECMWF AI                 AIFS                 AIFS ENS
NOAA hybrid                                   HGEFS
```

The value of this matrix is not the number of model names. It is that an agent can ask the **same atmospheric question** across provider, model class and uncertainty representation without learning another API.

## Architectural guardrails

Every addition in this roadmap must preserve:

1. **One public query language.** New datasets plug into the existing dataset/capability registry.
2. **Truthful capabilities.** No synthetic symmetry where the upstream model does not provide it.
3. **Native semantics.** Run cadence, grid, member population and provenance remain visible.
4. **Member-first ensemble physics.** Aggregate only after per-member nonlinear diagnostics.
5. **Source/access separation.** Provider etiquette, retries, concurrency, caching and transport remain access-policy concerns.
6. **CLI/MCP parity.** New normal capabilities appear through both surfaces from the same core.
7. **Comparison meaning over convenience.** Comparison strategies encode scientifically meaningful alignment, not generic subtraction.

## After this line

The AI/hybrid model matrix and comparison architecture are now complete. The next roadmap should choose a new major axis rather than add another model-specific public API: high-resolution regional NWP, broader forecast verification/skill, additional meteorological structure diagnostics, or a non-atmospheric domain such as waves.
