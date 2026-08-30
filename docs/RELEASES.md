# Releases

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
