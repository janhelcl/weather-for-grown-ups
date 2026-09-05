# Weather for Grown Ups

**Weather is the hello-world of agent tools. This is the version for when “temperature tomorrow” stops being enough.**

Weather for Grown Ups (WFG) gives agents and humans structured access to operational forecasts, ensembles, AI weather models, regional NWP and history from NOAA, ECMWF, DWD and Météo-France — one query language, many models, no flattened semantics.

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

## Ask a harder weather question

“What's the weather tomorrow?” is easy. These are more interesting.

**Synoptic · Aviation & soaring · Wind energy · AI vs physics · Verification**

<details open>
<summary><strong>Synoptic</strong> — Follow a front through the atmosphere</summary>

> A cold front is crossing Prague tomorrow. When does it actually arrive, how does the atmosphere change through the passage, and how much do the models agree?

`GFS + IFS → GEFS + IFS ENS → pressure profiles → run comparison`

An agent can locate the transition in deterministic guidance, inspect ensemble timing spread, follow the vertical structure before and after passage, and check whether successive runs are converging on the same story.

</details>

<details>
<summary><strong>Aviation & soaring</strong> — Understand the useful part of the day</summary>

> Tomorrow looks flyable around Bassano. What is likely to end the usable convective window first: increasing wind, cloud, stability, or a larger-scale change?

`profiles → parcel diagnostics → ensemble evolution → global + regional models`

An agent can inspect stability and parcel structure through time, see how wind evolves through the column, test the signal across ensemble members, and use regional guidance without turning WFG itself into a “go flying” score.

</details>

<details>
<summary><strong>Wind energy</strong> — Decide whether a ramp is real</summary>

> A sharp wind ramp appears over the North Sea tomorrow afternoon. Is it a broad synoptic transition or something only one grid point is seeing, and how uncertain is the timing?

`multi-point + area → transect → ensemble spread → model comparison`

An agent can move from a suspicious point signal to its spatial structure, compare deterministic models, and measure how consistently the ensemble supports the timing and magnitude of the change.

</details>

<details>
<summary><strong>AI vs physics</strong> — Compare different forecasting systems without pretending they are identical</summary>

> AIFS and IFS disagree materially on tomorrow's trough. Are the AI and physics models telling different atmospheric stories, or are those differences smaller than the uncertainty inside their ensembles?

`IFS ↔ AIFS → IFS ENS ↔ AIFS ENS → vertical + spatial comparison`

WFG keeps the models' native semantics intact while giving the agent a common vocabulary for aligned comparisons. Differences remain differences; unsupported symmetry is not invented for convenience.

</details>

<details>
<summary><strong>Verification</strong> — Ask what the forecast actually got right</summary>

> Three days ago the models called this event very differently. Which forecast got the structure and timing right, and have we seen atmospheric setups like this before?

`archived forecast → analysis / radiosonde → error → historical analogs`

An agent can retrieve the original forecast rather than today's reconstructed view of the event, compare it with later observations or analysis, quantify the miss, and search history for related atmospheric states.

</details>

The answer remains structured model evidence. Activity-specific scores, route choices and safety judgments stay downstream.

## Installation notes

The npm path includes the GRIB2 decoder and needs no separate weather tooling for any dataset. `icon-d2-eps`, which DWD publishes on its native triangular grid, is remapped in-process through DWD's own official nearest-neighbour index table, so no native binaries are required.

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
