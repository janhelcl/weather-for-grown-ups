# Roadmap

Weather for Grown Ups grows by adding **new weather-model semantics behind the same query language**, not by multiplying public APIs.

The standing architectural rule remains:

> **One query language over weather datasets. Native model semantics stay intact.**

Normal atmospheric access remains:

~~~text
dataset × geometry × time × selection
~~~

A new dataset should change what atmospheric evidence is available, not force callers to learn another query language.

## Current foundation

The v0.4 line completed the first global model-class matrix:

~~~text
                         deterministic        ensemble
NOAA physics             GFS                  GEFS
NOAA AI                  AIGFS                AIGEFS
ECMWF physics            IFS                  IFS ENS
ECMWF AI                 AIFS                 AIFS ENS
NOAA hybrid                                   HGEFS
~~~

WFG now exposes:

- global physics, AI and hybrid forecast populations;
- deterministic and member-first ensemble semantics;
- archived GFS forecasts, historical GFS analysis and GEFSv12 reforecasts;
- one public query/diagnostic vocabulary across point, points, time range, transect, area and profile operations;
- run comparison, restrictive cross-dataset comparison, verification and analog search;
- equal CLI and MCP surfaces over the same application core.

The AI/hybrid roadmap and comparison architecture are complete. The next major line should add a genuinely new axis rather than another global model-specific integration.

# Next major capability line: regional and convection-permitting NWP

The next roadmap extends WFG across the **spatial-scale axis**:

> **global ↔ regional ↔ convection-permitting**

The goal is not simply to add ICON-D2 and AROME. The goal is to prove that the same atmospheric query language works when datasets have limited geographic domains, kilometre-scale grids, shorter horizons, finer cadence and more explicitly resolved mesoscale structure.

Initial target families:

- DWD ICON-D2;
- DWD ICON-D2-EPS;
- Météo-France AROME;
- Météo-France PE-AROME.

Current upstream characteristics make these a useful architecture test:

- ICON-D2 is a roughly 2 km limited-area deterministic model;
- ICON-D2-EPS uses the same regional modelling family with 20 forecast members;
- AROME provides kilometre-scale deterministic regional guidance;
- PE-AROME provides a control plus 24 perturbed simulations with hourly output through roughly two days.

Exact public inventories, run schedules, retention, licences and access policies must be verified against the provider before each implementation. Provider-specific access constraints remain source-policy concerns rather than public query dimensions.

## 1. Spatial domain and grid semantics

**First milestone. Implement before the first regional dataset is considered complete.**

Limited-area NWP introduces semantics that global models never forced WFG to represent explicitly enough.

Add first-class descriptive/capability metadata for:

- geographic coverage/domain;
- native horizontal grid type and nominal resolution;
- forecast horizon and native cadence;
- whether a dataset is global or limited-area;
- deterministic versus ensemble result kind;
- provider and model class, reusing the existing registry metadata.

Coverage must be usable by capability discovery. The catalog should be able to answer questions such as:

- which datasets cover this point?
- which datasets cover this bounded area?
- which regional datasets expose this variable or diagnostic?
- what native grid and horizon does each candidate provide?

Out-of-domain queries must fail truthfully and distinctly from unsupported-variable, unavailable-run or source-access failures.

Do not add model-specific public geometry types or namespaces.

## 2. ICON-D2

Add DWD ICON-D2 as the first regional deterministic forecast dataset.

Goals:

- reuse the existing public atmospheric query/diagnostic schemas;
- introduce a DWD source/access implementation without leaking DWD-specific transport concepts upward;
- preserve ICON-D2-native domain, grid, run cadence, forecast horizon and provenance;
- support the common field/profile vocabulary only where the actual upstream inventory permits;
- prove that point, range, multi-point, transect and bounded-area operations behave correctly on a limited-area model.

The first implementation should prefer a coherent, well-tested shared-variable subset over pretending to match the full GFS/IFS inventories.

## 3. ICON-D2-EPS

Add ICON-D2-EPS as the first convection-permitting regional ensemble.

Ensemble meteorology remains **member first**:

- retrieve/select members;
- compute nonlinear diagnostics within each member;
- aggregate distributions only afterward.

Goals:

- preserve the native 20-member population;
- reuse the same regional coverage/grid abstraction established for ICON-D2;
- support point/range/multi-point/transect/area ensemble summaries where source volume and access patterns make them practical;
- expose truthful member and source provenance;
- avoid synthetic equivalence with GEFS, IFS ENS, AIGEFS or AIFS ENS.

This is the key test that WFG's ensemble architecture survives a radically different spatial scale.

## 4. AROME

Add Météo-France AROME as the second-provider regional deterministic dataset.

The purpose of this milestone is architectural as much as meteorological:

- prevent ICON/DWD-specific assumptions from becoming the generic regional abstraction;
- prove coverage and grid semantics across another provider;
- keep Météo-France account/token, retention, throttling and transport rules isolated in the source/access layer;
- reuse the same public query language and capability-validation boundaries.

Where AROME exposes multiple public grids or resolutions, WFG must represent them truthfully rather than silently substituting one product for another.

## 5. PE-AROME

Add PE-AROME as the second regional ensemble family.

Goals:

- preserve its native control/perturbed population rather than reshaping it to resemble ICON-D2-EPS;
- retain member-first diagnostic semantics;
- reuse the same regional-domain and capability architecture;
- validate that provider-specific ensemble packaging does not leak into the public schema.

At this point WFG should have two independent deterministic/ensemble regional families behind one atmospheric query language.

## 6. Cross-scale comparison architecture

Extend the restrictive comparison-strategy registry to scientifically meaningful **global ↔ regional** pairs.

Candidate families include:

- IFS ↔ ICON-D2;
- IFS ↔ AROME;
- GFS ↔ ICON-D2 where fields/times/domains genuinely align;
- IFS ENS ↔ ICON-D2-EPS;
- IFS ENS ↔ PE-AROME.

There must be **no universal global-to-regional subtraction fallback**.

Every strategy must explicitly declare:

- spatial overlap requirements;
- valid-time/run alignment;
- compatible variables/diagnostics;
- point-sampling semantics;
- any interpolation, aggregation or regridding rule;
- how native resolution differences are represented;
- comparison output and provenance shape.

Point comparison can be relatively direct. Spatial comparison requires much stricter semantics: a kilometre-scale regional field and a 0.25° global field must not be presented as if they were measurements on the same grid.

## 7. Regional and convective meteorology

Once the core regional datasets are stable, expand the shared meteorological vocabulary where the source products justify it.

High-value candidates include:

- convective precipitation and intense-precipitation fields;
- gusts;
- visibility and near-surface aviation fields;
- cloud-base/cloud-top structure;
- reflectivity-related fields where operationally available and scientifically interpretable;
- severe-convection ingredients derived from existing pressure/profile fields.

These remain atmospheric fields and diagnostics behind the existing query/diagnostic surfaces. Do not turn the core into an activity-specific forecast or safety layer.

## Regional roadmap definition of done

The line is complete when:

1. at least two providers expose regional deterministic forecasts through the same public query language;
2. at least two regional ensemble families preserve native member-first semantics;
3. geographic coverage and grid semantics are first-class and discoverable;
4. out-of-domain behavior is explicit and tested;
5. cross-scale comparisons route only through restrictive, scientifically declared strategies;
6. source access, retry/concurrency, caching and provider etiquette remain isolated from the public schema;
7. CLI and MCP expose equivalent normal capabilities from the same application core;
8. architecture tests prevent regional/provider-specific concepts from leaking into dataset-agnostic schemas.

# Parallel small extension: GEFS 00Z extended horizon

NOAA's operational 00Z GEFS cycle extends beyond the standard 16-day horizon to support weeks 3–4 guidance.

This is worth adding opportunistically without making it the central regional roadmap.

The implementation should remain the public GEFS dataset, preserving the actual lead-dependent cadence/grid/product semantics rather than inventing a separate "extended GEFS" dataset identity.

This extension is explicitly secondary to the regional architecture line and should not delay it.

# Following major axes

The regional line is the next priority. The likely major directions after it are:

## Forecast verification and model skill

Move from verifying individual forecasts toward comparing **historical model skill** over bounded samples.

Candidate capabilities:

- deterministic bias / MAE / RMSE and anomaly-oriented scores where meaningful;
- ensemble CRPS, Brier score, reliability, rank and spread-skill diagnostics;
- threshold/event verification;
- spatial verification for precipitation and other scale-sensitive fields;
- explicit model-skill comparison by variable, lead time, region and forecast regime.

Conceptually keep these operations distinct:

- compare_datasets: how forecasts differ;
- verify_forecast: how a forecast performed against a reference;
- future skill comparison: how forecast systems perform over samples.

AI-model archive depth is currently much shorter than long-lived physics archives. WFG should accumulate or index a truthful forecast-settlement corpus rather than pretending historical coverage exists where it does not.

## Waves and marine forecasting

Add a new geophysical-domain axis using NOAA and ECMWF wave products.

Potential matrix:

~~~text
                   deterministic       ensemble
NOAA physics       GFS Wave            GEFS Wave
ECMWF physics      IFS Wave            IFS ENS Wave
ECMWF AI           AIFS Wave           AIFS ENS Wave
~~~

The architectural question is whether the existing dataset × geometry × time × selection contract can generalize from atmospheric forecasts to another physical domain while keeping domain-specific variables and diagnostics explicit.

Wave products should be first-class datasets/domain metadata, not miscellaneous fields hidden inside atmospheric datasets.

## Extended and subseasonal range

Extend the temporal-scale axis from medium-range weather toward weeks 3–4 and subseasonal guidance.

At longer horizons, useful semantics increasingly include:

- weekly means;
- anomalies;
- threshold/event probabilities;
- climatology-relative quantities;
- calibrated ensemble distributions.

This should be designed as a real temporal-scale capability rather than merely accepting larger forecast-hour numbers.

## Additional meteorological diagnostics

Continue deepening the atmospheric diagnostic layer between major roadmap lines.

Candidates include:

- storm-relative helicity;
- precipitable-water and integrated-moisture diagnostics;
- Richardson-number / stability diagnostics;
- tropopause and isentropic structure;
- additional severe-convection ingredients.

These are valuable additions but are not, by themselves, the next architectural roadmap.

# Architectural guardrails

Every roadmap line must preserve:

1. **One public query language.** New datasets plug into the existing dataset/capability registry.
2. **Truthful capabilities.** No synthetic symmetry where the upstream model does not provide it.
3. **Native semantics.** Domain, run cadence, grid, member population, horizon and provenance remain visible.
4. **Member-first ensemble physics.** Aggregate only after per-member nonlinear diagnostics.
5. **Source/access separation.** Provider etiquette, authentication, retries, concurrency, caching and transport remain access-policy concerns.
6. **CLI/MCP parity.** New normal capabilities appear through both surfaces from the same core.
7. **Comparison meaning over convenience.** Comparison strategies encode scientifically meaningful alignment, not generic subtraction.
8. **Domain boundaries stay explicit.** Atmospheric evidence, future wave evidence and any activity-specific interpretation remain separate concerns.

The long-term value is not the number of model names. It is that an agent can ask the **same physical question across providers, model classes, uncertainty representations and spatial scales without learning another API**.
