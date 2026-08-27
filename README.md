# Weather for Grown Ups

**Everyone builds a weather tool for their first agent. This one grew up.**

Weather is the canonical agent tutorial: give the model a tool, ask for tomorrow's forecast, celebrate when it tells you to bring an umbrella.

**Weather for Grown Ups (WFG)** goes a bit further. It gives agents direct access to NOAA's GFS and GEFS numerical weather models — pressure profiles, mixed fields, ensemble distributions, diagnostics, parcel physics, time series, transects, area statistics, run comparisons, and more.

One TypeScript core powers equal CLI and MCP surfaces. No need to teach your agent how to wrestle GRIB files first.

Current release: **v0.1.0**.

## Quick start

Node.js 20+ is enough. The npm package includes its GRIB2 decoder; native `wgrib2` is optional.

```bash
npx weather-for-grown-ups --help
npx weather-for-grown-ups catalog --model gefs --search wind --json
```

Start either MCP transport from the same package:

```bash
npx weather-for-grown-ups mcp
npx weather-for-grown-ups mcp-http
```

See [installation and deployment](docs/INSTALL.md) for global npm, Docker, stdio MCP, Streamable HTTP MCP, and hosting details.

## What can an agent do with it?

WFG is deliberately a **tool**, not a forecast persona. It returns structured model data, diagnostics, provenance, and explicit ensemble semantics. The consuming agent decides what those data mean for the user's question.

The examples below are illustrative agent interpretations, not live forecasts and not literal WFG output.

### Scientific meteorology — Prague, Czechia

**You ask**

> A cold front is forecast to cross Prague tomorrow. How does the vertical structure of the atmosphere change as it passes, and how confident is the ensemble about the timing?

**The agent might use WFG**

`get_gfs_diagnostic_timeseries` → `get_gefs_diagnostic_timeseries` → `compare_gefs_runs`

**Example agent interpretation**

> The frontal signal is coherent through the lower and middle troposphere rather than being just a surface temperature change. The pre-frontal inversion erodes, the 850–700 hPa layer cools, and 850–500 hPa shear strengthens as the new air mass arrives. Most GEFS members show the same transition, but they spread it across several native forecast steps. Confidence is therefore higher in the air-mass change itself than in the exact hour it reaches Prague.

### Aviation / paragliding — Bassano del Grappa, Italy

**You ask**

> I'm considering an XC flight from Bassano del Grappa tomorrow. What does the atmospheric profile say about the usable convective window, and what is most likely to shut it down?

**The agent might use WFG**

`get_gfs_parcel_diagnostics` → `get_gefs_parcel_diagnostics` → `get_gefs_diagnostic_timeseries` → `get_gefs_fields_timeseries`

**Example agent interpretation**

> The profile becomes progressively more convective through late morning as inhibition weakens and the usable mixed layer deepens. The later constraint is not simply a lack of heating: winds through the lower and middle troposphere strengthen and shear increases into the afternoon. The ensemble agrees more strongly on that wind increase than on the exact instability magnitude, so the main robust signal is a narrowing window before the stronger flow arrives.

*Slightly more information than “Bassano: 21 °C, sunny.”*

### Mountaineering — Grossglockner, Austria

**You ask**

> I'm considering a Grossglockner summit attempt tomorrow morning. What conditions should I expect near summit altitude, and when does the weather start deteriorating?

**The agent might use WFG**

`get_gfs_profile` → `get_gefs_ensemble_profile` → `get_gefs_profile_diagnostics` → `get_gefs_fields_timeseries`

**Example agent interpretation**

> The valley-level forecast understates the change aloft. Near the pressure levels representative of the upper mountain, temperatures remain well below freezing while winds strengthen through the morning. Moisture also increases higher in the column later in the period, raising the risk of cloud around the high terrain. Ensemble agreement is tighter on the wind increase than on the moisture timing, making stronger summit-level flow the more robust deterioration signal.

WFG supplies atmospheric model evidence; a consuming agent should still treat mountaineering decisions as safety-critical and use appropriate local forecasts and observations.

### Wind energy — Esbjerg, Denmark

**You ask**

> A wind farm near Esbjerg expects a production ramp tomorrow afternoon. What is driving the change, how spatially uniform is it, and how confident is the forecast?

**The agent might use WFG**

`get_gefs_fields_points_timeseries` → `get_gefs_transect` → `compare_gefs_runs`

**Example agent interpretation**

> The ramp is associated with a broad strengthening of the low-level flow rather than one isolated grid point. Coastal samples strengthen first and most strongly, while points farther inland lag. Winds aloft increase at the same time, supporting a synoptic-scale interpretation rather than purely local mixing. GEFS spread is larger around the timing of the ramp than around the direction of change, so the bigger uncertainty is *when* the increase arrives rather than *whether* the regional flow strengthens.

WFG does not contain turbine power curves, wake models, availability assumptions, or a generation model. Converting atmospheric conditions into expected MW belongs to the consuming application.

## Current model support

WFG exposes deterministic **GFS 0.25°** and ensemble **GEFS 0.5°** while preserving their different semantics.

| Operation | GFS 0.25° | GEFS 0.5° |
| --- | --- | --- |
| Catalog and search | ✅ | ✅ |
| Pressure profiles | ✅ deterministic | ✅ member distributions |
| Mixed pressure/non-isobaric fields | ✅ | ✅ member-first bundles |
| Raw and mixed-field time series | ✅ | ✅ |
| Layer diagnostics | ✅ | ✅ per member → summarized |
| Whole-profile diagnostics | ✅ | ✅ per member → structural summaries |
| Parcel / LCL / LFC / EL / CAPE / CIN | ✅ | ✅ per member → summarized |
| Diagnostic time series | ✅ layer/profile/parcel | ✅ layer/profile/parcel |
| Multi-point queries | ✅ | ✅ |
| Multi-point time series | ✅ | ✅ |
| Transects | ✅ deterministic | ✅ ensemble-native mixed fields |
| Area statistics | ✅ deterministic | ✅ member-first spatial statistics |
| Run-to-run comparison | ✅ deterministic deltas | ✅ distribution shifts |
| Scalar ensemble distribution | — | ✅ |
| Aligned GFS-vs-GEFS comparison | ✅ | ✅ |

GEFS also supports control `c00` plus perturbed members `p01`–`p30`, native three-hour output through `f384`, mixed pressure/non-isobaric field bundles, and opt-in member payloads for auditability.

Historical **GFS Grid 4 0.5° analysis** is exposed as a third dataset through the `history-*` CLI and explicit historical MCP tools. It now covers profiles, time series, diagnostics, parcels, multi-point queries, multi-point time series, transects and native bbox area statistics while preserving analysis-time semantics and NCEI provenance.

## The design rule

> **Unify operations and physics; preserve model semantics.**

The same physical kernels are reused where that is scientifically valid. But deterministic GFS values are not forced into ensemble-shaped objects, and GEFS member distributions are not flattened into fake confidence scores.

In particular:

- nonlinear GEFS diagnostics are calculated **member by member before aggregation**;
- member fractions and spread are labeled as raw ensemble evidence, not calibrated probability or uncertainty;
- pressure levels, temporal semantics, valid times, cycles, sampling and provenance stay explicit;
- unsupported combinations fail explicitly rather than being guessed;
- WFG does not own activity-specific scores or safety judgments.

The [architecture guide](docs/ARCHITECTURE.md) goes deeper into the shared core, model adapters, member-first computation, source strategy, caching, and public surfaces.

## CLI

The CLI is operation-oriented. Where an operation has a unified command, it uses `--model gfs|gefs`; model-native aliases remain explicit where they make the contract clearer.

A deterministic profile:

```bash
wfg profile \
  --model gfs \
  --lat 50.08 --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --json
```

An ensemble parcel diagnostic:

```bash
wfg ensemble-parcel \
  --lat 45.80 --lon 11.77 \
  --valid 2026-08-24T12:00:00Z \
  --parcel surface_2m \
  --levels 1000,925,850,700,500,250,200 \
  --json
```

A mixed GEFS field bundle across multiple points and times:

```bash
wfg ensemble-fields-points-timeseries \
  --point 55.47,8.45 \
  --point 55.67,8.15 \
  --from 2026-08-24T06:00:00Z \
  --to 2026-08-25T18:00:00Z \
  --fields wind_10m \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Run `wfg --help` or `npx weather-for-grown-ups --help` for the complete command surface.

## MCP

MCP keeps explicit model-named tools instead of one giant polymorphic schema. That makes tool choice and input validation clearer for agents while both wrappers still delegate to the same core.

The v0.1.0 MCP surface includes model catalogs, profiles, raw and mixed fields, multi-point and time-series queries, layer/profile/parcel diagnostics, transects, area statistics, run comparison, GEFS ensemble distributions, and aligned GFS-vs-GEFS comparison.

Both transports expose the same tool set:

- **stdio** — `npx weather-for-grown-ups mcp`
- **Streamable HTTP** — `npx weather-for-grown-ups mcp-http`

The HTTP server defaults to `127.0.0.1:3000`, serves MCP at `/mcp`, and exposes `/healthz`. Read [INSTALL.md](docs/INSTALL.md) before exposing it remotely.

## Data access

WFG selects only the GRIB messages needed for a query, caches immutable upstream slices, decodes locally, and performs physical transforms and aggregation in the TypeScript core.

- GFS uses NOAA NOMADS where geographic subsetting is useful and NOAA AWS Open Data for reusable selected-message slices.
- GEFS uses NOAA AWS Open Data `.idx` inventories and byte-range access per member.
- The npm package ships with a GRIB2 decoder; native `wgrib2` remains an optional compatibility/debug path.
- Historical GFS analysis uses NOAA NCEI THREDDS/NCSS: grid-as-point for point/profile operations and native bbox/grid subsets for area statistics.
- NOAA/NCEI scripted archive requests share the cross-process courtesy limiter; AWS Open Data paths do not use it.

## Documentation

The repository root intentionally stays small. Detailed documentation lives in [`docs/`](docs/README.md).

Start with:

- [Installation and distribution](docs/INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GEFS ensemble access](docs/GEFS_ENSEMBLE.md)
- [Catalog search](docs/CATALOG_SEARCH.md)
- [Testing](docs/TESTING.md)
- [Meteorology validation](docs/METEOROLOGY_VALIDATION.md)

Feature-specific implementation and semantics notes are indexed in [docs/README.md](docs/README.md).

## License

MIT. NOAA model data and separately distributed decoder components retain their own upstream terms and licenses; see [installation and distribution](docs/INSTALL.md) for packaging details.
