# Documentation

Detailed documentation for **Weather for Grown Ups** lives here so the repository root can stay focused on the project itself.

## Start here

- [INSTALL.md](INSTALL.md) — npx, npm, Docker, stdio MCP, Streamable HTTP MCP, hosting and release packaging.
- [UNIFIED_API.md](UNIFIED_API.md) — preferred dataset × geometry × time × selection query language for CLI and MCP.
- [ARCHITECTURE.md](ARCHITECTURE.md) — shared core, model adapters, member-first physics, data access and public surfaces.
- [TESTING.md](TESTING.md) — deterministic unit/integration coverage and test organization.
- [LIVE_SMOKE.md](LIVE_SMOKE.md) — bounded real-NOAA smoke tests.
- [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) — physical validation and numerical expectations.
- [RELEASES.md](RELEASES.md) — release notes and compatibility changes.

## Discovery and shared operations

- [CATALOG_SEARCH.md](CATALOG_SEARCH.md) — unified catalog discovery across GFS, GEFS, IFS, IFS ENS, and GFS analysis.
- [HISTORY.md](HISTORY.md) — historical GFS Grid 4 analysis profiles from the NOAA NCEI archive.
- [DIAGNOSTIC_TIME_SERIES.md](DIAGNOSTIC_TIME_SERIES.md) — deterministic GFS diagnostic series semantics.
- [RUN_COMPARISON.md](RUN_COMPARISON.md) — deterministic GFS run-to-run comparison.
- [TRANSECT.md](TRANSECT.md) — deterministic GFS transects.
- [AREA_SUMMARY.md](AREA_SUMMARY.md) — bounded deterministic GFS area summaries.
- [AREA_DISTRIBUTION.md](AREA_DISTRIBUTION.md) — richer deterministic area distribution semantics.
- [GFS_GEFS_COMPARISON.md](GFS_GEFS_COMPARISON.md) — aligned deterministic-vs-ensemble comparison.
- [GFS_IFS_COMPARISON.md](GFS_IFS_COMPARISON.md) — aligned deterministic GFS-vs-IFS comparison with normalized deltas.
- [GEFS_IFS_ENS_COMPARISON.md](GEFS_IFS_ENS_COMPARISON.md) — aligned ensemble-vs-ensemble distribution comparison without cross-model member pairing.

## GEFS ensemble reference

- [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md) — GEFS contract and member-first surface guide.
- [GEFS_FIELD_BUNDLES.md](GEFS_FIELD_BUNDLES.md) — mixed pressure/non-isobaric field bundles and time series.
- [GEFS_MULTI_POINT.md](GEFS_MULTI_POINT.md) — member-first multi-point distributions.
- [GEFS_MULTI_POINT_TIME_SERIES.md](GEFS_MULTI_POINT_TIME_SERIES.md) — member-first spatial × temporal queries.
- [GEFS_PROFILE_DIAGNOSTICS.md](GEFS_PROFILE_DIAGNOSTICS.md) — freezing-level and inversion structure summaries.
- [GEFS_DIAGNOSTIC_TIME_SERIES.md](GEFS_DIAGNOSTIC_TIME_SERIES.md) — ensemble layer/profile/parcel diagnostics through time.
- [GEFS_RUN_COMPARISON.md](GEFS_RUN_COMPARISON.md) — distribution shifts across initialization cycles.
- [GEFS_TRANSECT.md](GEFS_TRANSECT.md) — ensemble-native mixed-field transects.

## Documentation conventions

WFG documentation distinguishes between three layers:

1. **WFG output** — structured model data, diagnostics, provenance and explicit ensemble statistics.
2. **Meteorological interpretation** — reasoning a consuming agent may perform from those outputs.
3. **Domain decisions** — aviation, mountaineering, energy or other activity-specific judgments, which remain outside the WFG core.

GEFS member fractions and spread are raw ensemble evidence unless a future validated calibration layer explicitly says otherwise.
