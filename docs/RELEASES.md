# Releases

## v0.5.0 — 2026-09-03

v0.5.0 completes WFG's regional/convection-permitting architecture while preserving the same public atmospheric query language.

### Regional deterministic and ensemble families

Four limited-area forecast populations are now first-class datasets behind the existing `dataset × geometry × time × selection` contract:

- DWD `icon-d2` — deterministic convection-permitting forecast with native ~2.1 km model-grid semantics;
- DWD `icon-d2-eps` — native 20-member regional ensemble with member-first diagnostics;
- Météo-France `arome` — deterministic AROME using the explicit 0.01° EURW1S100 public product while retaining the distinct ~1.3 km native-model mesh;
- Météo-France `pe-arome` — 25-member control/perturbed regional ensemble using authenticated targeted WCS access.

The public API does not gain model-specific geometry or transport namespaces. Dataset-native domain, grid, cadence, horizon, member population and source provenance remain explicit.

### Spatial domain and native-grid architecture

Limited-area coverage is now a first-class capability rather than an implicit source detail.

The dataset registry carries:

- global versus limited-area scope;
- conservative geographic coverage;
- native horizontal-grid type and nominal resolution;
- forecast horizon and native cadence;
- dataset/provider/model-class/result-kind metadata.

Catalog discovery can filter by coverage, and execution rejects out-of-domain requests with a distinct `OUT_OF_DOMAIN` failure before source access. Regular delivery grids are not silently presented as native model meshes.

### Restrictive global↔regional comparisons

`compare_datasets` now has explicit cross-scale strategies for:

- IFS ↔ ICON-D2;
- IFS ↔ AROME;
- GFS ↔ ICON-D2;
- IFS ENS ↔ ICON-D2-EPS;
- IFS ENS ↔ PE-AROME.

These strategies require a shared explicit initialization, compare only declared field/pressure intersections, sample each dataset independently at the requested point, preserve native-resolution provenance and perform no generic cross-grid subtraction or member pairing.

### Regional and convective meteorology

The regional vocabulary now includes a bounded set of provider-substantiated mesoscale fields, including where available:

- native wind gusts;
- column-maximum reflectivity;
- convective rain and convective snowfall water-equivalent accumulation;
- near-surface visibility and aviation ceiling;
- shallow-convection cloud-base/cloud-top structure;
- mean-layer CAPE/CIN;
- 2–8 km updraft-helicity maxima.

ICON-D2 also exposes provider-native top of dry convection. WFG deliberately does not manufacture equivalent AROME/PE-AROME capabilities where current public product identities do not substantiate the same quantity.

### Source and runtime boundaries

DWD and Météo-France transport specifics remain below the unified application boundary.

`icon-d2-eps` uses DWD's native all-member GRIB packaging and the official remapping/member-extraction path, requiring CDO plus native `wgrib2`. The Docker image supplies those dependencies. `pe-arome` keeps bearer credentials and targeted WCS request packaging in the source/access layer; normal anonymous datasets remain credential-free.

### Architecture and roadmap closeout

The regional roadmap now satisfies its definition of done: two providers, two deterministic regional models, two regional ensemble families, first-class domain/grid semantics, explicit out-of-domain behavior, restrictive cross-scale comparisons, source-policy isolation and shared CLI/MCP application services.

The next major roadmap line is **forecast verification and model skill**: generalizing the existing GFS verification corpus and bias/MAE/RMSE summaries into same-sample multi-model skill comparison and proper ensemble verification without pretending historical archives exist where they do not.

### Release validation

The release candidate uses the existing Node.js 20/24 typecheck, offline tests, coverage gates, build, CLI/package smoke tests, packed-package validation and Docker checks. Live regional checks cover ICON-D2, ICON-D2-EPS and AROME; PE-AROME remains credential-gated by design.

No existing public operation name or dataset ID is removed in this release.

## v0.4.0 — 2026-08-31

v0.4.0 completes WFG's first full physics/AI/hybrid model matrix while preserving the same public atmospheric query language.

### AI and hybrid forecast families

WFG now exposes five additional first-class forecast populations added after v0.3.0:

- NOAA `aigfs` — deterministic AIGFS;
- NOAA `aigefs` — 31-member AI ensemble with member-first diagnostics;
- ECMWF `aifs` — deterministic AIFS Single;
- ECMWF `aifs-ens` — native 51-member stochastic AIFS ensemble;
- NOAA `hgefs` — a 62-member hybrid distribution composed from 31 GEFS physics members and 31 AIGEFS AI members.

Each dataset remains behind the existing `dataset × geometry × time × selection` contract. Native grids, run cadence, horizons, member identities, source products and provenance stay explicit, and unsupported combinations fail at the capability boundary rather than being silently approximated.

### Model-class and capability architecture

Dataset metadata now treats provider, model class and result kind as first-class descriptive properties. Capability validation is centralized outside the dataset-agnostic public schema, so adding an AI or hybrid model does not create another public API family.

The completed model matrix is:

```text
                         deterministic        ensemble
NOAA physics             GFS                  GEFS
NOAA AI                  AIGFS                AIGEFS
ECMWF physics            IFS                  IFS ENS
ECMWF AI                 AIFS                 AIFS ENS
NOAA hybrid                                   HGEFS
```

### Restrictive cross-model comparisons

`compare_datasets` now dispatches through a restrictive strategy registry with no generic fallback.

The supported comparison families now include:

- deterministic deltas: GFS ↔ IFS, GFS ↔ AIGFS, IFS ↔ AIFS and AIGFS ↔ AIFS;
- deterministic-to-ensemble positioning: GFS ↔ GEFS and IFS ↔ IFS ENS;
- ensemble distribution shifts: GEFS ↔ IFS ENS, GEFS ↔ AIGEFS and IFS ENS ↔ AIFS ENS;
- hybrid-to-constituent distribution shifts: HGEFS ↔ GEFS and HGEFS ↔ AIGEFS.

Ensemble comparisons summarize native populations independently rather than inventing cross-model member pairing. HGEFS comparisons also make the overlapping constituent population explicit rather than implying statistical independence.

### Architecture cleanup

The post-roadmap cleanup sharpens the same architectural invariant used throughout v0.3:

> **One query language over weather datasets; native semantics stay explicit.**

- pair-native and normalized comparison strategies are separated behind one registry;
- comparison result normalization is isolated from orchestration;
- dataset capability modifiers are centralized behind a dedicated validation boundary;
- the unified public schema remains dataset-agnostic;
- architecture tests lock these layer boundaries and CLI/MCP equivalence.

### Release validation

The normal release candidate remains covered by Node.js 20/24 typecheck, tests, build and smoke checks, coverage, packed-package installation, and Docker validation.

The aggregate live suite now explicitly includes HGEFS alongside AIGFS, AIGEFS, AIFS/AIFS ENS, GFS/GEFS, ECMWF IFS, archive parity and verification checks.

No existing public operation name or dataset ID is removed in this release.

## v0.3.0 — 2026-08-30

v0.3.0 expands WFG's unified weather engine with a new retrospective ensemble forecast population and sharper model-comparison semantics, while keeping the core public query language stable.

### GEFSv12 retrospective forecasts

GEFSv12 reforecasts are now first-class behind the existing public `gefs` dataset using explicit `forecast.kind: "reforecast"` semantics.

The retrospective surface now includes:

- point and multi-point field queries;
- native pressure profiles;
- bounded point and multi-point time ranges across the native 3h → 6h cadence transition;
- mixed pressure + non-isobaric field selections with truthful separate-grid provenance where the archive meshes differ;
- member-first layer diagnostics for lapse rate, wind shear and potential-temperature gradient;
- member-first freezing-level and inversion diagnostics;
- truthful capability discovery that exposes only the retrospective subset actually supported.

Reforecasts remain explicitly distinct from archived operational GEFS runs.

### Model comparison

`compare_datasets` now also supports deterministic IFS versus IFS ENS. Since ECMWF Cycle 50r1 uses deterministic IFS as the unperturbed control, WFG places that control inside the aligned 50-perturbation distribution and reports rank, standardized offset and range position rather than fabricating a 51st ensemble member.

GFS transects also accept the same mixed pressure/non-isobaric field selection vocabulary used by the rest of the unified GFS query surface.

### Architecture hardening

The internal architecture was tightened around the project invariant:

> **One query language over weather datasets; native semantics stay explicit.**

- unified query/diagnostic/specialized operations dispatch through operation-specific adapter registries;
- CLI and MCP surface equivalence is tested explicitly;
- source access, retry/concurrency policy, caching, decoding and meteorological composition are separated more clearly;
- provider-specific access policies remain isolated rather than leaking NOMADS pacing into unrelated sources;
- documentation now treats the root README as the product front door and keeps model/source detail in the reference docs.

### Reliability

- IGRA retries transient network transport failures as well as retryable HTTP statuses;
- live and parity gates cover GFS, GEFSv12 reforecasts, ECMWF IFS/IFS ENS and IGRA verification;
- docs-only PRs avoid unnecessary expensive live parity gates where appropriate.

No public operation names or dataset IDs were removed in this release.

## v0.2.2 — 2026-08-30

v0.2.2 fixes runtime version reporting without changing the public query language.

- `wfg --version`, MCP server metadata and `/healthz` now derive their version from `package.json`;
- packaged-binary tests lock that behavior so release metadata cannot drift from the published package version.

## v0.2.1 — 2026-08-29

v0.2.1 hardens operational data access while keeping the v0.2 unified API unchanged.

- ordinary GFS point/profile and time-series access prefers NOAA AWS Open Data byte ranges;
- GFS time-series progress is emitted on stderr without contaminating JSON stdout;
- provider etiquette is source-specific rather than inheriting NOMADS pacing globally;
- NOAA AWS, ECMWF, NCEI, NCAR/GDEX and IGRA use independent bounded-concurrency policies;
- transient HTTP failures use bounded exponential backoff with jitter and `Retry-After` support;
- access locks heartbeat during long requests and concurrent cache writes use safer atomic temporary files.

## v0.2.0 — 2026-08-28

v0.2.0 turns WFG from a GFS/GEFS-focused toolkit into a unified multi-model atmospheric query engine.

The architectural rule for this release is:

> **One query language over weather datasets; dataset-native semantics stay explicit.**

### Unified public surface

Normal atmospheric access now uses one `dataset × geometry × time × selection` vocabulary across five public datasets:

- `gfs` — deterministic NOAA GFS, including transparent routing to archived forecast runs;
- `gefs` — NOAA GEFS, with member-first ensemble semantics;
- `ifs` — deterministic ECMWF IFS Open Data;
- `ifs-ens` — ECMWF IFS ENS perturbations `p01`–`p50`, diagnosed member first;
- `gfs-analysis` — historical NOAA GFS Grid 4 analysis.

The canonical CLI is intentionally small: `catalog`, `query`, `diagnose`, `compare-runs`, `compare-datasets`, `verify`, `analogs`, and `index`.

The canonical MCP surface remains seven tools: `search_catalog`, `query_atmosphere`, `diagnose_atmosphere`, `compare_runs`, `compare_datasets`, `verify_forecast`, and `find_analogs`.

### Historical GFS convergence

Historical access is no longer a separate model-specific API family.

- explicit old runs on `dataset: "gfs"` route transparently to the matching archive;
- operational and archived GFS support both 0.25° and 0.5° where the source archive permits it;
- `gfs-analysis` preserves analysis semantics without inventing a forecast axis;
- historical profiles, fields, diagnostics, parcels, time series, multi-point queries, transects, areas, analog search, and verification share the normal operation vocabulary where physically valid.

### Forecast verification

`verify_forecast` now supports both gridded GFS analysis and real radiosonde observations from NOAA IGRA as verification references.

The release includes atomic forecast verification, bounded skill summaries, and a materialized verification corpus for larger-scale evaluation. Observations remain verification references rather than being presented as fake atmospheric model datasets.

### ECMWF IFS

Deterministic ECMWF IFS is now a first-class dataset behind the same public query and diagnostic operations as GFS.

Supported capabilities include point/profile state, native-cadence time series, multi-point queries, transects, area statistics, layer/profile/parcel diagnostics, diagnostic time series, and run-to-run comparison.

Current deterministic IFS cadence is preserved explicitly:

- 00/12Z: through `f240`, 3-hourly through `f144`, then 6-hourly;
- 06/18Z: through `f090`, 3-hourly.

### ECMWF IFS ENS

`ifs-ens` exposes the 50 ECMWF perturbations directly and keeps nonlinear meteorology member first.

The ensemble surface includes point and multi-point distributions, native-cadence time series, layer/profile/parcel diagnostics, diagnostic time series, transects, area statistics, and run-distribution comparison.

Current ENS cadence is preserved explicitly:

- 00/12Z: through `f360`, 3-hourly through `f144`, then 6-hourly;
- 06/18Z: through `f144`, 3-hourly.

Since ECMWF Cycle 50r1, the unperturbed control is identical to deterministic `oper/fc`; WFG therefore exposes it truthfully through `dataset: "ifs"` instead of inventing an `ifs-ens` control member.

### Cross-model comparison

The existing `compare_datasets` operation now has three explicit statistical branches:

- GFS vs GEFS — deterministic forecast positioned against the ensemble distribution;
- GFS vs IFS — aligned deterministic model differences;
- GEFS vs IFS ENS — independently summarized ensemble-distribution shifts without cross-model member pairing.

This remains one public operation while preserving pair-specific statistical meaning.

### GEFS and spatial improvements

GEFS gained selected 0.25° surface-field access through the appropriate NOAA product while retaining 0.5° pressure/mixed-field semantics. Ensemble-native multi-point, time-series, transect, area, parcel, structural-profile, and run-comparison surfaces are all available through the unified operations.

### Release hardening

Before cutting v0.2.0, the dataset capability registry, public metadata, CLI parsing, MCP descriptions, catalog discovery, package smoke tests, documentation, and live release gates were aligned around the unified architecture.

The final release candidate is covered by normal CI on Node.js 20 and 24, coverage, package pack/install checks, Docker checks, live ECMWF IFS/ENS checks, IGRA verification, and GFS operational/archive parity gates.

### Compatibility notes

v0.2.0 intentionally removes the old model/history-specific public CLI commands and MCP tools that were retained temporarily during migration. Use the canonical operation vocabulary above and select the dataset in the request.

Historical GFS forecasts are still `dataset: "gfs"`; callers should not create a separate historical-forecast dataset identity.

Dataset-specific grids, forecast horizons, cadence, ensemble membership, provenance, and verification semantics remain explicit. Unified does not mean pretending the models are identical.

## v0.1.0 — 2026-08-26

Initial public npm/container release, centered on operational GFS and GEFS access, shared meteorological diagnostics, CLI/MCP distribution, and the bundled GRIB2 decoder.
