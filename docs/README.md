# Documentation

The root [README](../README.md) explains **why Weather for Grown Ups exists**. This directory explains how to use it, how the model semantics differ, and how the implementation stays true to one query language across multiple sources.

## Start here

| If you want to… | Read |
| --- | --- |
| run WFG locally or host MCP | [INSTALL.md](INSTALL.md) |
| understand the public query language | [UNIFIED_API.md](UNIFIED_API.md) |
| understand the layering and design rules | [ARCHITECTURE.md](ARCHITECTURE.md) |
| discover fields and capabilities | [CATALOG_SEARCH.md](CATALOG_SEARCH.md) |
| contribute or debug tests | [TESTING.md](TESTING.md) |
| understand physical/numerical validation | [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) |
| see release-level compatibility changes | [RELEASES.md](RELEASES.md) |\n| see what WFG is building next | [ROADMAP.md](ROADMAP.md) |

## Dataset and source semantics

These documents describe **what the upstream model/archive actually means**. They are intentionally separate from the model-neutral public query vocabulary.

- [AIGFS.md](AIGFS.md) — NOAA's deterministic AI forecast, native 6-hour cadence, operational field inventory and NOMADS partial-range access.
- [AIGEFS.md](AIGEFS.md) — NOAA's 31-member AI ensemble, member-first aggregation, native inventory and NOMADS member/statistics layout.
- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — operational GEFS plus the explicit GEFSv12 reforecast population, member sets, products, grids, cadence and member-first semantics.
- [IFS.md](IFS.md) — deterministic IFS and IFS ENS Open Data products, cadence, 50-perturbation semantics and ECMWF access behavior.
- [HISTORY.md](HISTORY.md) — historical GFS Grid 4 analysis, archived GFS forecasts, analog workflows and verification semantics.
- [HISTORY_FIELDS.md](HISTORY_FIELDS.md) — historical field availability and archive-specific constraints.
- [HISTORY_PARCEL.md](HISTORY_PARCEL.md) — parcel diagnostics over historical GFS analysis.

Operational GFS source routing is described in [ARCHITECTURE.md](ARCHITECTURE.md#data-access-and-caching) and the public grid/archive behavior in [UNIFIED_API.md](UNIFIED_API.md).

## Shared operation deep dives

Use these when the unified API contract is clear but the meteorological/statistical semantics of a composed operation need more detail.

- [RUN_COMPARISON.md](RUN_COMPARISON.md) — deterministic run-to-run deltas.
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — deterministic diagnostics through time.
- [TRANSECT.md](TRANSECT.md) — great-circle transect semantics.
- [AREA_SUMMARY.md](AREA_SUMMARY.md) and [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md) — bounded spatial statistics.
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — deterministic forecast positioned in an aligned ensemble.
- [GFS_IFS_COMPARISON.md](GFS_IFS_COMPARISON.md) — aligned deterministic cross-model differences.
- [GEFS_IFS_ENS_COMPARISON.md](GEFS_IFS_ENS_COMPARISON.md) — ensemble-distribution shifts without cross-center member pairing.
- [IFS_IFS_ENS_COMPARISON.md](IFS_IFS_ENS_COMPARISON.md) — deterministic IFS control positioned in its 50-perturbation ENS distribution.

## GEFS ensemble deep dives

The files below document ensemble-specific composition details. They should not redefine the public API; [UNIFIED_API.md](UNIFIED_API.md) remains the public contract.

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
- [LIVE_SMOKE.md](LIVE_SMOKE.md) — bounded live-source checks across NOAA and ECMWF.
- [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) — physical invariants and numerical expectations.
- [RELEASES.md](RELEASES.md) — release history and public compatibility notes.\n- [ROADMAP.md](ROADMAP.md) — planned AI, ensemble, hybrid and comparison-architecture work.

## Documentation rules

A few rules keep the documentation from drifting back into model-by-model API silos:

1. **The root README sells the product; it is not the reference manual.**
2. **UNIFIED_API.md owns the public vocabulary.** Dataset documents explain capability/source differences, not alternative public APIs.
3. **ARCHITECTURE.md owns layering decisions.** Source etiquette, cache policy and decoder choices should not be re-explained differently in every feature document.
4. **Model-specific documents preserve native semantics.** Do not manufacture symmetry that the upstream datasets do not have.
5. **Examples distinguish WFG output from agent interpretation.** WFG returns structured model evidence; downstream domain judgment stays downstream.

For ensembles, member fractions and spread are raw ensemble evidence unless an explicitly validated calibration layer says otherwise.
