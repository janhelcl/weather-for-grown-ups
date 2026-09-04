# WFG documentation

The root [README](../README.md) explains the product and gets you to a first query. This index points to the source of truth once you need exact behavior, model-specific semantics or implementation detail.

The organizing rule is simple:

> **One public atmospheric language. Model-specific documents explain differences; they do not create model-specific APIs.**

## Start with the job

| You need to… | Read |
| --- | --- |
| install WFG or run CLI/MCP | [INSTALL.md](INSTALL.md) |
| understand the exact public query contract | [UNIFIED_API.md](UNIFIED_API.md) |
| discover fields, geometry and dataset capabilities | [CATALOG_SEARCH.md](CATALOG_SEARCH.md) |
| understand layers, dependency direction and adapter boundaries | [ARCHITECTURE.md](ARCHITECTURE.md) |
| work with historical forecasts, analyses or verification | [HISTORY.md](HISTORY.md) |
| understand errors and unsupported capability boundaries | [ERRORS.md](ERRORS.md) |
| contribute or debug tests | [TESTING.md](TESTING.md) |
| understand physical/numerical validation | [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) |
| see release-level changes | [RELEASES.md](RELEASES.md) |
| see what WFG is building next | [ROADMAP.md](ROADMAP.md) |

## Dataset semantics

These documents describe what each upstream model or archive actually means: cadence, grids, members, field inventory, source access and capability boundaries. The public request vocabulary remains the one defined in [UNIFIED_API.md](UNIFIED_API.md).

### NOAA: physics, AI and hybrid

- [AIGFS.md](AIGFS.md) — deterministic AI forecast, native 6-hour cadence, field inventory and NOMADS partial-range access.
- [AIGEFS.md](AIGEFS.md) — 31-member AI ensemble, member mapping, member-first diagnostics and EAGLE AWS access.
- [HGEFS.md](HGEFS.md) — 62-member GEFS + AIGEFS hybrid, constituent identity, capability intersection and native-grid provenance.
- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — operational GEFS plus explicit GEFSv12 reforecast semantics, members, grids and cadence.

Operational deterministic GFS routing is documented in [ARCHITECTURE.md](ARCHITECTURE.md#data-access-and-caching); its public grid/archive behavior is part of [UNIFIED_API.md](UNIFIED_API.md).

### ECMWF: physics and AI

- [IFS.md](IFS.md) — deterministic IFS and IFS ENS Open Data products, cadence, ensemble semantics and access behavior.
- [AIFS.md](AIFS.md) — deterministic AIFS Single semantics and capability boundaries.
- [AIFS_ENS.md](AIFS_ENS.md) — 51-member stochastic AIFS ensemble, dedicated control semantics and indexed `cf`/`pf` access.

### Météo-France regional models

- [AROME.md](AROME.md) — deterministic AROME, native-model versus public-delivery grid semantics, field inventory and Open Data package access.
- [PE_AROME.md](PE_AROME.md) — 25-member PE-AROME ensemble, member-first field distributions, WCS delivery grid and authenticated targeted access.

### History and verification

- [HISTORY.md](HISTORY.md) — archived GFS forecasts, GFS Grid 4 analysis, analog workflows and verification semantics.
- [HISTORY_FIELDS.md](HISTORY_FIELDS.md) — historical field availability and archive-specific constraints.
- [HISTORY_PARCEL.md](HISTORY_PARCEL.md) — parcel diagnostics over historical GFS analysis.

`gfs-analysis` is historical model analysis, not observations or homogeneous reanalysis. NOAA IGRA is a verification reference rather than a fake gridded WFG dataset.

## Operation deep dives

Use these when the unified contract is clear but a composed meteorological/statistical operation needs more detail.

- [RUN_COMPARISON.md](RUN_COMPARISON.md) — deterministic run-to-run deltas.
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — diagnostics through time.
- [TRANSECT.md](TRANSECT.md) — great-circle transect semantics.
- [AREA_SUMMARY.md](AREA_SUMMARY.md) and [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md) — bounded spatial statistics.
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — deterministic forecast positioned in an aligned ensemble.
- [GFS_IFS_COMPARISON.md](GFS_IFS_COMPARISON.md) — aligned deterministic cross-model differences.
- [GEFS_IFS_ENS_COMPARISON.md](GEFS_IFS_ENS_COMPARISON.md) — ensemble-distribution shifts without cross-center member pairing.
- [IFS_IFS_ENS_COMPARISON.md](IFS_IFS_ENS_COMPARISON.md) — deterministic IFS positioned in its ENS distribution.
- [CROSS_SCALE_COMPARISON.md](CROSS_SCALE_COMPARISON.md) — restrictive global↔regional point comparison, shared-cycle rules and native-grid provenance.

### GEFS-specific operation detail

- [GEFS_FIELD_BUNDLES.md](GEFS_FIELD_BUNDLES.md) — mixed pressure/non-isobaric field bundles.
- [GEFS_MULTI_POINT.md](GEFS_MULTI_POINT.md) — member-first multi-point distributions.
- [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md) — spatial × temporal ensemble queries.
- [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md) — freezing-level and inversion summaries.
- [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md) — layer/profile/parcel diagnostics through time.
- [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md) — distribution shifts across forecast cycles.
- [GEFS_TRANSECT.md](GEFS_TRANSECT.md) — member-first great-circle transects.

## Engineering and validation

- [ARCHITECTURE.md](ARCHITECTURE.md) — dependency direction, adapter registries, source/access/cache boundaries and CLI/MCP parity.
- [TESTING.md](TESTING.md) — deterministic unit/integration coverage and test organization.
- [LIVE_SMOKE.md](LIVE_SMOKE.md) — bounded live-source checks.
- [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) — physical invariants and numerical expectations.
- [RELEASES.md](RELEASES.md) — release history and public compatibility notes.
- [ROADMAP.md](ROADMAP.md) — planned capability work.

## Documentation contract

Documentation has ownership boundaries just like code:

1. **`README.md` owns the product story and first success.** It should stay short enough to read before using WFG.
2. **`UNIFIED_API.md` owns the public vocabulary and exact request semantics.** Do not duplicate large canonical API tables elsewhere.
3. **Dataset documents own model/source differences.** They describe native capabilities and caveats, never an alternative public API.
4. **`ARCHITECTURE.md` owns layering and dependency rules.** Provider etiquette, caching and decoder choices belong there rather than leaking into every feature document.
5. **Operation deep dives own composed meteorological/statistical semantics.** They should build on the unified contract rather than restating it.
6. **Examples keep interpretation downstream.** WFG returns structured model evidence; domain decisions stay with the consuming application or agent.

For ensembles, member fractions and spread are raw model evidence unless an explicitly validated calibration layer says otherwise.
