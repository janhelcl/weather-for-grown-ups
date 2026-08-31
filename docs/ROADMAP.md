# Roadmap

Weather for Grown Ups grows by adding **new model semantics behind the same query language**, not by multiplying public APIs.

The standing architectural rule remains:

> **One query language over weather datasets. Native model semantics stay intact.**

The next development line extends WFG across a new model-class axis: physics-based, AI-based and hybrid numerical weather prediction.

## Current foundation

WFG already exposes:

- NOAA GFS and GEFS;
- ECMWF IFS and IFS ENS;
- archived GFS forecasts, historical GFS analysis and GEFSv12 reforecasts;
- deterministic and member-first ensemble semantics;
- one public query/diagnostic vocabulary across point, points, time range, transect, area and profile operations;
- run comparison, cross-dataset comparison, verification and analog search;
- equal CLI and MCP surfaces over the same application core.

The roadmap below should preserve those boundaries rather than creating model-specific public namespaces.

## Next major capability line

### 1. AIGFS

Add NOAA AIGFS as the first AI forecast dataset.

Goals:

- reuse the existing NOAA/GRIB/access layers where the upstream product permits;
- normalize AIGFS into the same atmospheric state and field vocabulary used by GFS/IFS;
- expose only capabilities supported by the real AIGFS inventory and cadence;
- make model class explicit in dataset metadata instead of encoding AI behavior in ad-hoc branches.

AIGFS is the first test that WFG can change the forecasting machinery without changing the atmospheric question.

### 2. AIFS

Add ECMWF AIFS after AIGFS.

Goals:

- prove the AI-model abstraction across a second provider;
- reuse ECMWF Open Data access and source-policy layers where appropriate;
- avoid any AIGFS-specific concept leaking into the public API;
- preserve AIFS-native run, cadence, grid, field and provenance semantics.

Together, AIGFS and AIFS establish a clean provider-independent AI forecast axis.

### 3. AI ensembles and hybrid ensemble

Add the corresponding ensemble/hybrid products:

- NOAA AIGEFS — **implemented** as the 31-member `aigefs` dataset with member-first state, area and diagnostic aggregation;
- ECMWF AIFS ENS;
- NOAA HGEFS hybrid ensemble.

Ensemble meteorology remains **member first**. Nonlinear diagnostics are evaluated within each member before aggregation.

Hybrid semantics must be explicit. HGEFS must not be treated as an ordinary homogeneous ensemble if its member population contains materially different model classes. Results and provenance should retain enough information to distinguish physics, AI and hybrid composition where that distinction matters.

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

The AI expansion must **not** continue the current pattern of accumulating one bespoke comparison module per dataset pair.

Introduce a comparison-strategy registry behind the existing public `compare_datasets` operation.

A strategy declares, at minimum:

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

Likely comparison families include:

- GFS ↔ AIGFS;
- IFS ↔ AIFS;
- GEFS ↔ AIGEFS;
- IFS ENS ↔ AIFS ENS;
- GFS ↔ IFS;
- AIGFS ↔ AIFS;
- GEFS ↔ IFS ENS;
- HGEFS ↔ its relevant constituent ensemble populations.

Existing comparison semantics should migrate behind the same strategy boundary rather than remaining a parallel legacy design.

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

Only after the AI/hybrid model matrix and comparison architecture are solid should the project reconsider the next major axis, such as high-resolution regional NWP, broader forecast verification/skill, additional meteorological structure diagnostics, or non-atmospheric domains such as waves.
