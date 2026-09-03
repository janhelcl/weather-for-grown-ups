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

The v0.4 line completed WFG's first global physics/AI/hybrid model-class matrix. The v0.5 line completes the next architectural axis: **global ↔ regional ↔ convection-permitting**.

~~~text
                         deterministic        ensemble
NOAA physics             GFS                  GEFS
NOAA AI                  AIGFS                AIGEFS
ECMWF physics            IFS                  IFS ENS
ECMWF AI                 AIFS                 AIFS ENS
NOAA hybrid                                   HGEFS

DWD regional             ICON-D2              ICON-D2-EPS
Météo-France regional    AROME                PE-AROME
~~~

WFG now exposes:

- global physics, AI and hybrid forecast populations;
- two independent regional deterministic/ensemble families;
- deterministic and member-first ensemble semantics across global and regional scales;
- first-class limited-area domain, native-grid, nominal-resolution, horizon and cadence metadata;
- archived GFS forecasts, historical GFS analysis and GEFSv12 reforecasts;
- one public query/diagnostic vocabulary across point, points, time range, transect, area and profile operations;
- restrictive run, model-class and global↔regional comparison strategies;
- verification, bounded local skill summaries and analog search;
- equal CLI and MCP surfaces over the same application core.

The global model-class matrix and regional/convection-permitting roadmap are complete. New regional fields can continue to land opportunistically where provider inventories substantiate them, but they are no longer a reason to keep the architectural line open.

# Completed capability line: regional and convection-permitting NWP ✅

The v0.5 roadmap extended WFG across the **spatial-scale axis**:

> **global ↔ regional ↔ convection-permitting**

The purpose was not merely to add model names. It was to prove that the same atmospheric query language survives limited geographic domains, kilometre-scale grids, shorter horizons, finer cadence, provider-specific packaging and explicitly resolved mesoscale structure.

The line now includes:

- DWD ICON-D2;
- DWD ICON-D2-EPS;
- Météo-France AROME;
- Météo-France PE-AROME.

Provider-specific access constraints remain source-policy concerns rather than public query dimensions.

## 1. Spatial domain and grid semantics ✅

The dataset registry carries first-class spatial domain, native-grid, nominal-resolution, horizon and native-cadence metadata. Catalog discovery can filter by global versus limited-area scope and by whether a declared domain covers a point or bounded area. Query and diagnostic dispatch reject unsupported geography with distinct `OUT_OF_DOMAIN` semantics before source access.

Regional models use the same public geometry vocabulary as global models; model-specific grid/projection concepts stay behind the dataset capability boundary.

## 2. ICON-D2 ✅

DWD ICON-D2 is the first regional deterministic dataset behind the shared atmospheric query language. It preserves the limited-area domain, 3-hourly run schedule, hourly forecast cadence and 48-hour horizon, while keeping the native ~2.1 km icosahedral model grid distinct from the DWD 0.02° regular-lat/lon delivery product.

Point, range, multi-point, multi-point-range, transect and bounded-area operations are supported over a verified field/pressure subset, with shared diagnostics where inventory permits them. DWD URL construction, compression, run probing, access policy and caching remain below the unified adapter boundary.

## 3. ICON-D2-EPS ✅

DWD ICON-D2-EPS preserves its native 20-member convection-permitting population and the same limited-area capability contract. WFG handles DWD's all-member GRIB2 packaging, official grid remapping and member extraction below the public API; nonlinear diagnostics remain member-first.

Point/range, multi-point/range, transect and bounded-area ensemble summaries use the existing ensemble result semantics with explicit member/run/source provenance.

## 4. AROME ✅

Météo-France AROME proves the regional abstraction across a second provider. WFG exposes the current 0.01° EURW1S100 public product with its limited-area domain, 3-hourly initialization schedule and hourly output through f51.

The nominal ~1.3 km model mesh remains distinct from the delivery grid. The integration deliberately does not mix pressure levels from the separate 0.025° product family, and Météo-France object naming/access/caching stays below the shared application boundary.

## 5. PE-AROME ✅

Météo-France PE-AROME is the second regional ensemble family. WFG preserves the native 25-member control/perturbed population (`c00,p01..p24`), limited metropolitan domain, 0.025° WCS delivery grid, 6-hourly production cycles and hourly output through f51.

The current capability exposes only verified near-surface WCS identities. One initialization is pinned across members, aggregation remains member-first, and bearer credentials plus one-member/one-field targeted WCS packaging remain source/access concerns.

## 6. Cross-scale comparison architecture ✅

The restrictive comparison registry contains explicit point strategies for:

- IFS ↔ ICON-D2;
- IFS ↔ AROME;
- GFS ↔ ICON-D2;
- IFS ENS ↔ ICON-D2-EPS;
- IFS ENS ↔ PE-AROME.

Every strategy declares shared initialization/valid-time rules, compatible field or pressure intersections, domain requirements, independent point sampling, native-resolution provenance and no cross-dataset regridding. Ensemble pairs compare independent distributions without member pairing. There is no universal global-to-regional subtraction fallback.

## 7. Regional and convective meteorology ✅

The v0.5 release boundary adds a deliberately bounded set of provider-substantiated mesoscale fields without pretending inventories are symmetric.

DWD ICON-D2 and ICON-D2-EPS expose, where available:

- native gust semantics;
- column-maximum reflectivity;
- phase-explicit convective rain and convective snowfall water-equivalent accumulations;
- near-surface visibility;
- provider-native aviation ceiling height above mean sea level;
- shallow-convection cloud-base/cloud-top heights above mean sea level;
- provider-native mean-layer CAPE/CIN;
- provider-native 2–8 km updraft-helicity maxima over the previous one-hour interval.

Deterministic ICON-D2 additionally exposes top of dry convection above mean sea level. AROME and PE-AROME do not advertise equivalent fields unless their current products substantiate the same physical quantity.

This milestone is intentionally **not field-parity complete**. Further severe-convection, cloud, moisture and aviation diagnostics can land as small extensions when scientifically justified; they no longer keep the architectural line open.

## Regional roadmap definition of done ✅

All release-defining criteria are satisfied:

1. at least two providers expose regional deterministic forecasts through the same public query language;
2. at least two regional ensemble families preserve native member-first semantics;
3. geographic coverage and grid semantics are first-class and discoverable;
4. out-of-domain behavior is explicit and tested;
5. cross-scale comparisons route only through restrictive, scientifically declared strategies;
6. source access, retry/concurrency, caching and provider etiquette remain isolated from the public schema;
7. CLI and MCP expose equivalent normal capabilities from the same application core;
8. architecture tests prevent regional/provider-specific concepts from leaking into dataset-agnostic schemas.

Regional work after v0.5 is maintenance or meteorological depth unless it introduces a genuinely new architectural requirement.

# Parallel small extension: GEFS 00Z extended horizon

NOAA's operational 00Z GEFS cycle extends beyond the standard 16-day horizon to support weeks 3–4 guidance.

This is worth adding opportunistically without making it the central regional roadmap.

The implementation should remain the public GEFS dataset, preserving the actual lead-dependent cadence/grid/product semantics rather than inventing a separate "extended GEFS" dataset identity.

This extension remains opportunistic. It should not reopen or delay the completed regional line, and it should not distract from the model-skill roadmap.

# Next major capability line: forecast verification and model skill

The next roadmap moves WFG from answering **what the models say** to answering **how forecast systems perform over comparable historical samples**.

WFG already has the seed of this capability: atomic archived-GFS verification against later GFS analysis or IGRA radiosondes, a resumable local verification corpus, and bounded bias/MAE/RMSE summaries by lead/pressure/field. The next line should generalize that architecture rather than create a second, disconnected verification system.

The central distinction remains:

- `compare_datasets`: how two forecasts differ for one aligned case;
- `verify_forecast`: how one forecast performed against one reference case;
- **model skill**: how forecast systems perform over an explicitly defined sample.

Historical skill is therefore a composition capability above the normal `dataset × geometry × time × selection` query language, not another model-specific namespace.

## 1. Generalized evaluation-case and corpus semantics

Define one normalized evaluation-case boundary that can represent:

- forecast dataset and native initialization/lead;
- reference dataset or observation source;
- requested and actually sampled location/grid/station;
- canonical variable/field/level selection;
- valid time and forecast lead;
- deterministic value, ensemble distribution or event outcome as appropriate;
- source/model version and provenance needed to interpret historical changes.

The current local GFS verification JSONL corpus is an implementation seed, not a permanent public storage contract. Storage, backfill and settlement mechanics must remain below the public skill semantics.

Missing cases stay explicit. A skill result must disclose selected cases, materialized/evaluable cases, failures, exclusions and coverage rate rather than silently scoring whatever happened to download.

## 2. Truthful historical coverage and settlement

Generalize resumable verification backfill into a dataset-aware settlement pipeline.

Priorities:

- preserve the long-lived GFS archive as the first deep deterministic corpus;
- add other physics models only where truthful forecast archives and comparable references exist;
- accumulate AI, hybrid and regional forecast cases forward when deep public archives do not exist;
- never imply historical skill for periods where the forecast population was unavailable;
- record model/product version changes so a long sample does not masquerade as one stationary forecast system.

The architecture should support local materialization first while keeping the corpus abstraction replaceable by a database/object-store implementation later.

## 3. Deterministic skill summaries

Lift the existing GFS bias/MAE/RMSE kernels into a dataset-neutral scoring layer.

Initial statistics:

- count and coverage;
- bias;
- MAE;
- RMSE;
- circular error treatment for direction-like quantities;
- anomaly/correlation-oriented scores only where a reference climatology is explicitly defined.

Every statistic must retain variable, level/field, lead-time and sample provenance. Aggregation across physically different quantities or unmatched samples is forbidden.

## 4. Same-sample model skill comparison

Add explicit forecast-system comparison over a **shared evaluation sample**.

A pairwise skill comparison must:

- intersect cases by valid time, location/reference, selection and lead;
- report how many cases each model had before and after same-sample intersection;
- compare metrics only on that common sample;
- preserve each model's native grid/source provenance;
- avoid interpreting a lower error from a different sample as superior skill.

This should be a dedicated specialized composition capability, distinct from single-case `compare_datasets`.

## 5. Ensemble and probabilistic verification

Extend scoring only where the stored corpus preserves member-level or distribution-level information required by the metric.

High-value targets:

- CRPS for continuous scalar ensemble forecasts;
- Brier score for declared threshold events;
- reliability and resolution summaries where sample size supports them;
- rank/PIT-style diagnostics where the reference and ensemble semantics permit them;
- spread-skill diagnostics;
- explicit raw-versus-calibrated probability labeling.

Member-first physics remains unchanged. Verification must score the forecast distribution that actually existed, not a synthetic ensemble reconstructed from aggregate quantiles.

## 6. Stratification and regime-aware skill

Allow bounded skill queries by scientifically meaningful dimensions such as:

- forecast lead;
- variable/field/pressure level;
- geographic point or bounded region;
- month/season;
- initialization cycle;
- declared weather regime or threshold event.

Stratification must disclose sample counts and avoid producing apparently precise metrics from tiny subsets.

## 7. Spatial verification

Treat precipitation and other scale-sensitive regional fields separately from point error metrics.

Potential methods include neighborhood/event scores and scale-aware spatial verification, but no method should be generalized until its alignment and regridding semantics are explicit. A kilometre-scale regional forecast and a coarse global analysis must not be scored as if they were collocated measurements on one grid.

## Model-skill roadmap definition of done

The line is complete when:

1. evaluation cases and corpus coverage are dataset-neutral and provenance-complete;
2. deterministic skill can be summarized for more than one forecast system where historical evidence genuinely exists;
3. pairwise model skill uses explicit same-sample intersection;
4. at least one ensemble family supports proper probabilistic scoring from preserved distribution/member evidence;
5. sample coverage, exclusions and model-version caveats are first-class output;
6. CLI and MCP expose the same normal skill capability from one application service;
7. corpus storage/backfill remains replaceable infrastructure rather than part of the public weather schema;
8. tests prevent single-case comparison semantics from leaking into historical skill comparison.

# Following major axes

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
