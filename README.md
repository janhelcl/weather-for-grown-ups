# Weather for Grown Ups

**Numerical weather prediction for agents — one query language, many models, no flattened semantics.**

Weather for Grown Ups (WFG) gives agents and humans structured access to operational forecasts, ensembles, AI weather models, regional NWP and history from NOAA, ECMWF, DWD and Météo-France.

> **One query language across weather datasets. Native model semantics stay intact.**

Ask the same atmospheric question of GFS, IFS, AIFS, GEFS, AIGEFS, ICON-D2, AROME or another supported dataset without learning another provider API. WFG handles source access, GRIB decoding, caching, normalization and shared meteorological physics while preserving the model's real grid, cadence, run, member and provenance semantics.

WFG is a weather **engine**, not a weather app: it returns atmospheric evidence and diagnostics; downstream agents decide how to interpret them.

## 30-second start

Requires Node.js 20+.

```bash
npx weather-for-grown-ups catalog --dataset all --search wind --json

npx weather-for-grown-ups query \
  --dataset gfs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,wind \
  --levels 850,700,500 \
  --json
```

Run the same core through MCP:

```bash
npx weather-for-grown-ups mcp
# Streamable HTTP:
npx weather-for-grown-ups mcp-http
```

For global npm, Docker, hosted MCP and PE-AROME credentials, see [Installation](docs/INSTALL.md).

## The contract

Normal atmospheric access is four orthogonal choices:

```text
dataset × geometry × time × selection
```

For example:

```json
{
  "dataset": "gefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-30T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

Change the dataset; keep the question. Capability differences remain explicit: unsupported combinations fail rather than being coerced into fake symmetry.

The exact public contract lives in [Unified atmospheric API](docs/UNIFIED_API.md).

## One core, two equal surfaces

CLI and MCP are thin adapters over the same schemas and application services. Their equivalence is tested explicitly.

| Purpose | CLI | MCP |
| --- | --- | --- |
| Discover fields and capabilities | `catalog` | `search_catalog` |
| Query atmospheric state | `query` | `query_atmosphere` |
| Derive layer/profile/parcel meteorology | `diagnose` | `diagnose_atmosphere` |
| Compare forecast cycles | `compare-runs` | `compare_runs` |
| Compare registered model pairs | `compare-datasets` | `compare_datasets` |
| Verify archived forecasts | `verify` | `verify_forecast` |
| Search historical analogs | `analogs` | `find_analogs` |

Administrative history-index build/backfill stays CLI-only by design; it is not part of the weather-query surface.

## Models without model-specific APIs

| Family | Public dataset IDs |
| --- | --- |
| Global deterministic physics | `gfs`, `ifs` |
| Deterministic AI | `aigfs`, `aifs` |
| Physics ensembles | `gefs`, `ifs-ens` |
| AI ensembles | `aigefs`, `aifs-ens` |
| Hybrid ensemble | `hgefs` |
| Regional deterministic | `icon-d2`, `arome` |
| Regional ensembles | `icon-d2-eps`, `pe-arome` |
| Historical analysis | `gfs-analysis` |

Historical GFS forecasts keep `dataset: "gfs"` with an explicit old run; GEFSv12 reforecasts keep `dataset: "gefs"` with `forecast.kind: "reforecast"`. WFG does not invent new dataset identities just because the backing source changes.

Use `catalog` / `search_catalog` as the source of truth for each dataset's supported fields, geometry, cadence, horizon, members and diagnostics.

## What WFG handles

The common query language spans:

- point and multi-point atmospheric state;
- native-cadence time ranges;
- pressure profiles and mixed pressure/non-isobaric fields;
- great-circle transects and bounded area statistics;
- layer, profile and parcel diagnostics where source fields support them;
- member-first ensemble distributions and diagnostics;
- deterministic run deltas and ensemble distribution shifts;
- explicitly registered cross-model comparisons across physics, AI, hybrid and spatial-scale boundaries;
- archived-forecast verification against later GFS analysis or IGRA radiosondes;
- local historical analog search.

Not every model supports every operation. That asymmetry is part of the truth, not something WFG hides.

## Design rules

WFG is deliberately opinionated where weather tooling often becomes subtly misleading:

- **Native semantics survive normalization.** Shared vocabulary does not erase model class, grid, cadence, domain, member population or provenance.
- **Ensemble physics is member-first.** Nonlinear diagnostics are evaluated inside each member before aggregation.
- **Spread is not calibrated uncertainty.** Ensemble fractions and spread are raw model evidence unless a separately validated calibration layer says otherwise.
- **History stays history.** Archived forecasts retain initialization and lead; analyses retain analysis-time semantics; retrospective ensembles stay explicitly retrospective.
- **Unsupported means unsupported.** WFG fails at capability boundaries instead of silently substituting another grid, field or model.
- **Transport is not the domain.** Provider routing, retries, pacing, cache policy and decoder choice stay below the public atmospheric contract.

See [Architecture](docs/ARCHITECTURE.md) for the dependency boundaries behind those rules.

## What can you ask?

WFG is useful once “temperature tomorrow” is not enough:

> How do GFS and IFS differ at 500 hPa over this route?

> What does the ensemble say about the timing and spread of tomorrow's wind shift?

> How does the vertical profile evolve through a frontal passage?

> What did the 48-hour GFS forecast predict for this event, and how wrong was it?

> Is a regional-model signal coherent with the global model, or just a local grid-scale feature?

The answer remains structured model evidence. Activity-specific scores, route choices and safety judgments stay downstream.

## Installation notes

The normal npm path includes the GRIB2 decoder and needs no separate weather tooling. `icon-d2-eps` is the current exception: DWD's native triangular-grid ensemble path requires CDO plus `wgrib2`; the Docker image includes both.

Most datasets use anonymous Open Data. `pe-arome` requires a Météo-France bearer token and subscribed WCS endpoint configuration.

Full setup: [docs/INSTALL.md](docs/INSTALL.md).

## Documentation

Start with the [documentation index](docs/README.md), then go as deep as the task requires:

- [Unified atmospheric API](docs/UNIFIED_API.md) — public vocabulary and exact semantics
- [Architecture](docs/ARCHITECTURE.md) — layers, dependency direction, source/access/cache boundaries and CLI/MCP parity
- [Catalog search](docs/CATALOG_SEARCH.md) — capability discovery
- [Historical access and verification](docs/HISTORY.md) — archives, analyses and verification
- [Testing](docs/TESTING.md) and [meteorology validation](docs/METEOROLOGY_VALIDATION.md) — software and physical correctness
- [Roadmap](docs/ROADMAP.md) — what comes next

Dataset-specific documents explain model/source differences without redefining the public API.

## Scope

WFG exposes numerical-model evidence and meteorological diagnostics. It does **not** own activity-specific scores, turbine power curves, route decisions, flight/summit safety judgments or calibrated probabilities unless such a layer is explicitly designed and validated.

That separation is intentional: one weather engine should serve many agents and applications without smuggling one application's judgment into the core.

## License

MIT. See [LICENSE](LICENSE).
