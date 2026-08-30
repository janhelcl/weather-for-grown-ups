# Weather for Grown Ups

**Weather is the hello-world of agent tools. This is the version for when “temperature tomorrow” stops being enough.**

Weather for Grown Ups (WFG) gives agents direct, structured access to numerical weather prediction: NOAA **GFS**, **GEFS** and historical GFS data, plus ECMWF **IFS** and **IFS ENS**.

The central idea is deliberately simple:

> **One query language over weather datasets. Native model semantics stay intact.**

Ask for a point, a time range, several locations, a transect, an area, a pressure profile or a meteorological diagnostic. Change the dataset without learning another API. WFG handles source selection, GRIB message access, decoding, caching and shared physics; the result keeps the model's real cadence, grid, run, member and provenance semantics.

No weather API key. No model-specific public namespaces. No need to teach the agent GRIB first.

## 30-second start

Node.js 20+ is enough. The npm package includes its GRIB2 decoder.

```bash
npx weather-for-grown-ups --help
npx weather-for-grown-ups catalog --dataset all --search wind --json
```

Run the same core as MCP:

```bash
npx weather-for-grown-ups mcp
# or
npx weather-for-grown-ups mcp-http
```

For global npm, Docker and hosted MCP setup, see [Installation](docs/INSTALL.md).

## The query model

Normal atmospheric access is expressed as four orthogonal choices:

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
    "pressureLevelsHpa": [850, 700, 500],
    "fields": ["temperature_2m", "wind_10m"]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

The same vocabulary is used for deterministic forecasts, ensembles, archived forecasts and historical analyses. Capability differences are explicit: unsupported combinations fail rather than being coerced into fake symmetry.

The full contract lives in [Unified atmospheric API](docs/UNIFIED_API.md).

## What can an agent ask?

WFG is intentionally a **tool**, not a forecast persona. It supplies atmospheric evidence; the consuming agent supplies interpretation.

### Synoptic and profile meteorology

> A cold front is crossing Prague. How does the vertical structure change, and how confident is the ensemble about the timing?

An agent can combine GFS/GEFS pressure profiles, inversion and lapse-rate diagnostics, ensemble distributions and run-to-run changes. The useful answer is no longer just a surface temperature—it can reason about the structure and timing of the air-mass transition.

### Aviation and paragliding

> What does the Bassano profile say about tomorrow's usable convective window, and what is most likely to shut it down?

An agent can inspect parcel diagnostics, CAPE/CIN, freezing levels, wind shear and the member-by-member GEFS distribution through time. WFG deliberately does not turn those into a “go flying” score; activity-specific judgment stays outside the core.

*Slightly more information than “Bassano: 21 °C, sunny.”*

### Wind energy

> Is tomorrow afternoon's wind ramp near Esbjerg a local grid-point feature or a regional change, and how uncertain is the timing?

An agent can combine multi-point queries, transects, area statistics and ensemble evolution to distinguish a spatially coherent flow change from a local signal.

### Forecast verification

> What did the 48-hour GFS forecast predict for this event, and how wrong was it?

Old GFS initializations stay `dataset: "gfs"` and route to the matching archive. WFG can compare them with later GFS analysis or NOAA IGRA radiosondes, and can summarize bias, MAE and RMSE over bounded samples.

## Datasets

| Public dataset | Meaning | Key semantics |
| --- | --- | --- |
| `gfs` | NOAA deterministic GFS | 0.25° default / 0.5° optional; operational data and archived forecasts share one public identity |
| `gefs` | NOAA GEFS | member-first operational ensemble; explicit `forecast.kind: "reforecast"` selects the GEFSv12 retrospective population |
| `ifs` | ECMWF deterministic IFS | 0.25° Open Data forecast with native ECMWF run/cadence semantics |
| `ifs-ens` | ECMWF IFS ENS | 50 perturbations `p01`–`p50`; deterministic IFS is the Cycle-50r1 unperturbed control |
| `gfs-analysis` | historical GFS Grid 4 analysis | deterministic analyzed state with analysis-time rather than forecast-lead semantics |

NOAA IGRA is available as a **verification reference**, not as a fake gridded model dataset.

For source inventories, cadence, member sets and archive details, start with [the documentation index](docs/README.md).

## One core, two equal surfaces

CLI and MCP are adapters over the same schemas and application services. Surface equivalence is tested explicitly.

| Operation | CLI | MCP |
| --- | --- | --- |
| Discover capabilities | `catalog` | `search_catalog` |
| Query atmospheric state | `query` | `query_atmosphere` |
| Derive meteorology | `diagnose` | `diagnose_atmosphere` |
| Compare forecast cycles | `compare-runs` | `compare_runs` |
| Compare datasets | `compare-datasets` | `compare_datasets` |
| Verify forecasts | `verify` | `verify_forecast` |
| Search historical analogs | `analogs` | `find_analogs` |

Administrative index build/backfill remains CLI-only on purpose; it is not part of the normal weather-query surface.

## What the engine covers

The common language composes a fairly broad atmospheric surface:

- pressure profiles and mixed pressure/non-isobaric fields;
- native-cadence time ranges;
- multi-point queries and multi-point ranges;
- great-circle transects;
- bounded area statistics;
- layer diagnostics such as lapse rate, wind shear and potential-temperature gradient;
- whole-profile freezing-level and inversion diagnostics;
- parcel/LCL/LFC/EL/CAPE/CIN diagnostics where the source fields support them;
- deterministic run deltas and ensemble distribution shifts;
- aligned GFS↔GEFS, GFS↔IFS, GEFS↔IFS ENS and IFS↔IFS ENS comparisons;
- historical analog search and archived-forecast verification.

Not every dataset implements every line. `catalog` / `search_catalog` is the source of truth for what a particular dataset and forecast population supports.

## Semantics are part of the API

WFG is opinionated about a few things that are easy to get subtly wrong:

- **Ensemble physics is member-first.** Nonlinear diagnostics are computed inside each GEFS/IFS ENS member before aggregation.
- **Spread is not calibrated uncertainty.** Member fractions and ensemble spread are reported as raw model evidence unless a dedicated calibrated layer says otherwise.
- **History is not relabeled as “current”.** Archived GFS forecasts retain their old initialization and lead; GFS analysis retains analysis-time semantics; GEFSv12 reforecasts are explicitly retrospective forecasts, not archived operational GEFS.
- **Provenance stays visible.** Results keep run, valid time, sampled grid, source product and archive/backend information.
- **Unsupported means unsupported.** The engine fails at capability boundaries instead of silently substituting another model, grid or physical meaning.

The deeper reasoning is documented in [Architecture](docs/ARCHITECTURE.md).

## Data access without the plumbing leaking into the query

WFG selects only the upstream messages needed for a request, caches immutable slices and decodes locally.

Operational point/profile access favors indexed byte-range reads from NOAA AWS Open Data and ECMWF Open Data. Bounded GFS areas use NOMADS geographic subsetting where that is materially better. Historical products route to NCEI or NCAR/GDEX as appropriate.

Provider etiquette is also source-specific: NOMADS retains its courtesy pacing, while AWS, ECMWF, NCEI, GDEX and IGRA use independent bounded-concurrency policies with transient retry/backoff. A slow provider does not impose its policy on unrelated sources.

Those are implementation and provenance concerns—not new public query dimensions.

## Documentation

The root README is the product overview. Detailed reference material lives under [`docs/`](docs/README.md).

Start here:

- [Installation and deployment](docs/INSTALL.md)
- [Unified atmospheric API](docs/UNIFIED_API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GEFS and GEFSv12 reforecast semantics](docs/GEFS_ENSEMBLE.md)
- [ECMWF IFS / IFS ENS semantics](docs/IFS.md)
- [Historical GFS, archives and verification](docs/HISTORY.md)
- [Testing](docs/TESTING.md) and [meteorology validation](docs/METEOROLOGY_VALIDATION.md)
- [Release notes](docs/RELEASES.md)\n- [Roadmap](docs/ROADMAP.md)

## Scope

WFG exposes numerical-model evidence and meteorological diagnostics. It does **not** own activity-specific scores, turbine power curves, route decisions, flight/summit safety judgments or calibrated probabilities unless such a layer is explicitly designed and validated.

That separation is intentional: the tool should be reusable by many agents and applications without smuggling one application's judgment into the weather core.

## License

MIT. See [LICENSE](LICENSE).
