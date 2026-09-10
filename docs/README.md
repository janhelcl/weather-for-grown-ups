# WFG documentation

Start with the job. Everything else is reference.

## Start here

| I want to… | Read |
| --- | --- |
| run a first query | [root README](../README.md) |
| see what serious investigations look like | [EXAMPLES.md](EXAMPLES.md) |
| set up Codex, Claude Code, Hermes, OpenClaw or another agent | [agents/README.md](agents/README.md) |
| install CLI, MCP, Docker or hosted MCP | [INSTALL.md](INSTALL.md) |
| understand the query contract | [UNIFIED_API.md](UNIFIED_API.md) |
| discover fields, levels, geometry and model capabilities | [CATALOG_SEARCH.md](CATALOG_SEARCH.md) |
| work with history or verification | [HISTORY.md](HISTORY.md) |

The portable [WFG skill](../skills/weather-for-grown-ups/SKILL.md) gives agents the investigation workflow. Exact syntax stays in CLI help / MCP schemas; exact capabilities stay in the catalog.

## Dataset semantics

Model-specific docs explain what the upstream forecast system actually provides. They do **not** define separate APIs.

**NOAA**

- [AIGFS](AIGFS.md)
- [AIGEFS](AIGEFS.md)
- [HGEFS](HGEFS.md)
- [GEFS / GEFSv12 reforecast](GEFS_ENSEMBLE.md)

**ECMWF**

- [IFS / IFS ENS](IFS.md)
- [AIFS](AIFS.md)
- [AIFS ENS](AIFS_ENS.md)

**Météo-France**

- [AROME](AROME.md)
- [PE-AROME](PE_AROME.md)

**History**

- [Historical access and verification](HISTORY.md)
- [Historical field coverage](HISTORY_FIELDS.md)
- [Historical parcel diagnostics](HISTORY_PARCEL.md)

Regional-model capabilities not called out above remain discoverable through the catalog and unified API.

## Operations

- [Alignment across datasets, runs and members](ALIGNMENT.md)
- [Diagnostic time series](DIAGNOSTIC_TIME_SERIES.md)
- [Transects](TRANSECT.md)
- [Area summary](AREA_SUMMARY.md) · [area distribution](AREA_DISTRIBUTION.md)

GEFS-specific deep dives: [field bundles](GEFS_FIELD_BUNDLES.md) · [multi-point](GEFS_MULTI_POINT.md) · [multi-point time series](GEFS_MULTI_POINT_TIME_SERIES.md) · [profile diagnostics](GEFS_PROFILE_DIAGNOSTICS.md) · [diagnostic time series](GEFS_DIAGNOSTIC_TIME_SERIES.md) · [transects](GEFS_TRANSECT.md)

## Engineering

- [Architecture](ARCHITECTURE.md)
- [Testing](TESTING.md)
- [Live-source smoke tests](LIVE_SMOKE.md)
- [Meteorology validation](METEOROLOGY_VALIDATION.md)
- [Releases](RELEASES.md)
- [Roadmap](ROADMAP.md)

One public atmospheric language remains the organizing rule: **dataset × geometry × time × selection**.
