# Weather for Grown Ups

**Everyone builds a weather tool for their first agent. This one grew up.**

Weather is the canonical agent tutorial: give the model a tool, ask for tomorrow's forecast, celebrate when it tells you to bring an umbrella.

**Weather for Grown Ups (WFG)** goes a bit further. It gives agents direct access to NOAA's GFS/GEFS and ECMWF's deterministic IFS / IFS ENS numerical weather models — pressure profiles, mixed fields, ensemble distributions, diagnostics, parcel physics, time series, transects, area statistics, run comparisons, and more.

One TypeScript core powers equal CLI and MCP surfaces. The public contract is deliberately model-neutral: **one query language over weather datasets**, with model-specific cadence, provenance and deterministic/ensemble semantics preserved behind it. No need to teach your agent how to wrestle GRIB files first.

## Quick start

Node.js 20+ is enough. The npm package includes its GRIB2 decoder; native `wgrib2` is optional.

```bash
npx weather-for-grown-ups --help
npx weather-for-grown-ups catalog --dataset gefs --search wind --json
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

`diagnose_atmosphere` on `gfs` → `diagnose_atmosphere` on `gefs` → `compare_runs` on `gefs`

**Example agent interpretation**

> The frontal signal is coherent through the lower and middle troposphere rather than being just a surface temperature change. The pre-frontal inversion erodes, the 850–700 hPa layer cools, and 850–500 hPa shear strengthens as the new air mass arrives. Most GEFS members show the same transition, but they spread it across several native forecast steps. Confidence is therefore higher in the air-mass change itself than in the exact hour it reaches Prague.

### Aviation / paragliding — Bassano del Grappa, Italy

**You ask**

> I'm considering an XC flight from Bassano del Grappa tomorrow. What does the atmospheric profile say about the usable convective window, and what is most likely to shut it down?

**The agent might use WFG**

`diagnose_atmosphere` on `gfs` → `diagnose_atmosphere` on `gefs` → `query_atmosphere` time series on `gefs`

**Example agent interpretation**

> The profile becomes progressively more convective through late morning as inhibition weakens and the usable mixed layer deepens. The later constraint is not simply a lack of heating: winds through the lower and middle troposphere strengthen and shear increases into the afternoon. The ensemble agrees more strongly on that wind increase than on the exact instability magnitude, so the main robust signal is a narrowing window before the stronger flow arrives.

*Slightly more information than “Bassano: 21 °C, sunny.”*

### Mountaineering — Grossglockner, Austria

**You ask**

> I'm considering a Grossglockner summit attempt tomorrow morning. What conditions should I expect near summit altitude, and when does the weather start deteriorating?

**The agent might use WFG**

`query_atmosphere` on `gfs` → `query_atmosphere` on `gefs` → `diagnose_atmosphere` on `gefs`

**Example agent interpretation**

> The valley-level forecast understates the change aloft. Near the pressure levels representative of the upper mountain, temperatures remain well below freezing while winds strengthen through the morning. Moisture also increases higher in the column later in the period, raising the risk of cloud around the high terrain. Ensemble agreement is tighter on the wind increase than on the moisture timing, making stronger summit-level flow the more robust deterioration signal.

WFG supplies atmospheric model evidence; a consuming agent should still treat mountaineering decisions as safety-critical and use appropriate local forecasts and observations.

### Wind energy — Esbjerg, Denmark

**You ask**

> A wind farm near Esbjerg expects a production ramp tomorrow afternoon. What is driving the change, how spatially uniform is it, and how confident is the forecast?

**The agent might use WFG**

`query_atmosphere` with GEFS points/time range → `query_atmosphere` with a GEFS transect → `compare_runs`

**Example agent interpretation**

> The ramp is associated with a broad strengthening of the low-level flow rather than one isolated grid point. Coastal samples strengthen first and most strongly, while points farther inland lag. Winds aloft increase at the same time, supporting a synoptic-scale interpretation rather than purely local mixing. GEFS spread is larger around the timing of the ramp than around the direction of change, so the bigger uncertainty is *when* the increase arrives rather than *whether* the regional flow strengthens.

WFG does not contain turbine power curves, wake models, availability assumptions, or a generation model. Converting atmospheric conditions into expected MW belongs to the consuming application.

## Current model support

WFG exposes deterministic **GFS 0.25° and 0.5°** (`0p25` default), member-first **GEFS**, deterministic **ECMWF IFS 0.25°**, and **ECMWF IFS ENS 0.25°**. Deterministic IFS has the broad spatiotemporal/diagnostic surface; IFS ENS supports member-first point and multi-point distributions, native-cadence point/multi-point time series, member-first diagnostics, and native-cadence diagnostic time series across all 50 perturbations.

| Operation | GFS 0.25° / 0.5° | GEFS | IFS 0.25° | IFS ENS 0.25° |
| --- | --- | --- | --- | --- |
| Catalog and search | ✅ | ✅ | ✅ | ✅ |
| Pressure profiles | ✅ deterministic | ✅ member distributions | ✅ deterministic | ✅ member distributions |
| Mixed pressure/non-isobaric fields | ✅ | ✅ member-first bundles | ✅ point + instant | ✅ member-first point + multi-point bundles |
| Raw and mixed-field time series | ✅ | ✅ | ✅ deterministic | ✅ member distributions |
| Layer diagnostics | ✅ | ✅ per member → summarized | ✅ deterministic | ✅ per perturbation → summarized |
| Whole-profile diagnostics | ✅ | ✅ per member → structural summaries | ✅ deterministic | ✅ structural member summaries |
| Parcel / LCL / LFC / EL / CAPE / CIN | ✅ | ✅ per member → summarized | ✅ deterministic | ✅ per perturbation → summarized |
| Diagnostic time series | ✅ layer/profile/parcel | ✅ layer/profile/parcel | ✅ layer/profile/parcel | ✅ compact member-first |
| Multi-point queries | ✅ | ✅ | ✅ | ✅ member distributions |
| Multi-point time series | ✅ | ✅ | ✅ | ✅ native 3h/6h cadence |
| Transects | ✅ deterministic | ✅ ensemble-native mixed fields | ✅ deterministic mixed fields | ✅ member-first mixed fields |
| Area statistics | ✅ deterministic | ✅ member-first spatial statistics | ✅ deterministic raw scalar | ✅ member-first spatial statistics |
| Run-to-run comparison | ✅ deterministic deltas | ✅ distribution shifts | ✅ deterministic deltas | ✅ distribution shifts, 6h/12h stride |
| Scalar ensemble distribution | — | ✅ | — | ✅ 50 perturbations |
| Aligned GFS-vs-GEFS comparison | ✅ | ✅ | — | — |
| Aligned GFS-vs-IFS comparison | ✅ deterministic deltas | — | ✅ deterministic deltas | — |
| Aligned GEFS-vs-IFS ENS comparison | — | ✅ distribution shifts | — | ✅ distribution shifts |

GEFS also supports control `c00` plus perturbed members `p01`–`p30`, native three-hour output through `f384`, mixed pressure/non-isobaric field bundles, and opt-in member payloads for auditability. Field-only requests automatically use NOAA's `pgrb2s` 0.25° selected-field product through `f240`; pressure-level and mixed requests use `pgrb2a` 0.5°, and field ranges extending beyond `f240` stay on 0.5° for the whole range. Result provenance reports the actual product and horizontal grid.

ECMWF **IFS 0.25°** is exposed as `ifs`; **IFS ENS 0.25°** is `ifs-ens`. Both use official Open Data indexed byte-range access with bounded mirror retry/failover. Under Cycle 50r1 the products deliberately have different horizons: deterministic `oper/fc` runs to `f240` at 00/12Z and `f90` at 06/18Z, while perturbed `enfo/ef` runs to `f360` and `f144` respectively. `ifs-ens` represents the 50 perturbed members `p01`–`p50`; the unperturbed control is now identical to deterministic `ifs`, so WFG does not invent a 51st ENS member. See [IFS access](docs/IFS.md).

Historical **GFS Grid 4 0.5° analysis** is exposed as `gfs-analysis`, through the same `query` / `diagnose` CLI operations and `query_atmosphere` / `diagnose_atmosphere` MCP tools. It covers profiles, time series, diagnostics, parcels, multi-point queries, multi-point time series, transects and native bbox area statistics while preserving analysis-time semantics and NCEI provenance.

Historical **GFS forecasts** do not add another public dataset. Keep `dataset: "gfs"`, provide an explicit old forecast run, and select `forecast.grid` when needed. `0p25` routes to the NCAR/GDEX d084001 0.25° archive (`gfs_0p25_forecast_archive`), available from 2015-01-15 with native 3-hour output through +240 h and 12-hour output from +252 h through +384 h. `0p50` routes to NOAA NCEI Grid 4 (`gfs_grid4_forecast_0p5_archive`), beginning 2006-10-10 with native 3-hour output through +192 h. Direct online archive availability can vary. Both paths preserve run, valid time, lead, grid and archive provenance across unified state queries and layer/profile/parcel diagnostics.

Forecast verification can use either the later `gfs-analysis` model state or a real **NOAA IGRA v2.2 radiosonde** reference. IGRA remains a verification reference rather than a public gridded atmospheric dataset: WFG selects a nearby or explicit sounding station, samples the archived GFS forecast at the sounding location, and compares only pressure levels that were actually observed. No vertical interpolation is hidden inside the verification result.

The same `verify_forecast` operation also supports **bounded forecast-skill summaries** against either reference. Use a time range plus up to three lead times; WFG samples at most eight nominal verification times (24 forecast evaluations maximum), keeps failed cases explicit, and returns count, signed bias, MAE and RMSE by lead × pressure × field. `gfs-analysis` summaries remain same-grid 0.5° analysis-minus-forecast comparisons; IGRA summaries remain observation-minus-forecast and report the radiosonde stations used. Wind-direction errors use shortest signed angular differences.

For larger verification studies, `wfg index verification-backfill` materializes atomic cases into a local JSONL corpus and `wfg index verification-summary` aggregates multi-year or month-filtered seasonal skill with **zero NOAA requests**. Coverage is reported explicitly, so partially materialized periods stay distinguishable from complete samples. This remains CLI-side administration; it does not expand the seven-tool MCP surface.

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

## Public API

WFG exposes the dataset-oriented query vocabulary documented in [UNIFIED_API.md](docs/UNIFIED_API.md).

Normal atmospheric access is expressed as:

```text
dataset × geometry × time × selection
```

with short dataset IDs `gfs`, `gefs`, `ifs`, `ifs-ens`, and `gfs-analysis`. The same query structure therefore works for a deterministic forecast, an ensemble forecast, an archived GFS forecast, or an archived analysis while each result preserves its native deterministic/ensemble and forecast/analysis semantics. An archived forecast remains `gfs`; the explicit old `forecast.run` selects the historical state.

The MCP vocabulary is intentionally small:

- `search_catalog`
- `query_atmosphere`
- `diagnose_atmosphere`
- `compare_runs`
- `compare_datasets`
- `verify_forecast`
- `find_analogs`

The CLI mirrors the same concepts with `catalog --dataset ...`, `query`, `diagnose`, `compare-runs`, `compare-datasets`, `verify`, and `analogs`.

## CLI

The CLI mirrors the same operation vocabulary. Dataset choice is always explicit through `--dataset`.

A deterministic GFS profile:

```bash
wfg query \
  --dataset gfs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --json
```

An old forecast keeps `gfs` and selects the historical initialization:

```bash
wfg query \
  --dataset gfs \
  --grid 0p25 \
  --run 2019-12-24T12:00:00Z \
  --lat 50.08 --lon 14.43 \
  --at 2019-12-26T18:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --json
```

The same query against historical analysis only changes the dataset and time:

```bash
wfg query \
  --dataset gfs-analysis \
  --lat 50.08 --lon 14.43 \
  --at 2019-12-26T18:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --json
```

An ensemble parcel diagnostic:

```bash
wfg diagnose \
  --dataset gefs \
  --lat 45.80 --lon 11.77 \
  --at 2026-08-24T12:00:00Z \
  --kind parcel \
  --parcel surface_2m \
  --levels 1000,925,850,700,500,250,200 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Local analog-index maintenance is intentionally separate from weather queries:

```bash
wfg index build --dataset gfs-analysis ...
wfg index backfill --dataset gfs-analysis ...
```

Run `wfg --help` or `npx weather-for-grown-ups --help` for the complete command surface.

## MCP

MCP exposes exactly seven atmospheric tools:

- `search_catalog`
- `query_atmosphere`
- `diagnose_atmosphere`
- `compare_runs`
- `compare_datasets`
- `verify_forecast`
- `find_analogs`

Both transports expose exactly the same tool set:

- **stdio** — `npx weather-for-grown-ups mcp`
- **Streamable HTTP** — `npx weather-for-grown-ups mcp-http`

The HTTP server defaults to `127.0.0.1:3000`, serves MCP at `/mcp`, and exposes `/healthz`. Read [INSTALL.md](docs/INSTALL.md) before exposing it remotely.

## Data access

WFG selects only the GRIB messages needed for a query, caches immutable upstream slices, decodes locally, and performs physical transforms and aggregation in the TypeScript core.

- GFS source routing is automatic by default: point/profile, time-series, multi-point, transect, and run-comparison access uses NOAA AWS Open Data selected-message byte ranges; bounded area queries use NOAA NOMADS geographic subsetting. `--source` remains an explicit override where that geometry supports it, and result provenance reports the resolved backend.
- GEFS uses NOAA AWS Open Data `.idx` inventories and byte-range access per member. Pressure/mixed selections use `pgrb2a` 0.5°; eligible field-only selections use `pgrb2s` 0.25° through `f240`.
- The npm package ships with a GRIB2 decoder; native `wgrib2` remains an optional compatibility/debug path.
- Historical GFS analysis uses NOAA NCEI THREDDS/NCSS: grid-as-point for point/profile operations and native bbox/grid subsets for area statistics.
- Historical GFS forecasts keep the public `gfs` identity and route by grid: 0.25° uses NCAR/GDEX d084001 through THREDDS/NCSS, while 0.5° uses NOAA NCEI Grid 4 through THREDDS/NCSS. Direct online availability varies; older Grid 4 files may require NCEI HAS retrieval.
- Upstream etiquette is provider-specific: NOMADS keeps an 11-second cross-process courtesy interval, NCEI THREDDS/NCSS is bounded to 2 concurrent requests, NCAR/GDEX to 4, and IGRA downloads to 4. NOAA AWS and ECMWF cloud/direct access are bounded separately without inheriting the NOMADS delay. Transient 429/5xx responses use exponential backoff with jitter and honor `Retry-After`.

## Documentation

The repository root intentionally stays small. Detailed documentation lives in [`docs/`](docs/README.md).

Start with:

- [Installation and distribution](docs/INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [GEFS ensemble access](docs/GEFS_ENSEMBLE.md)
- [ECMWF IFS and ENS access](docs/IFS.md)
- [Catalog search](docs/CATALOG_SEARCH.md)
- [Testing](docs/TESTING.md)
- [Meteorology validation](docs/METEOROLOGY_VALIDATION.md)

Feature-specific implementation and semantics notes are indexed in [docs/README.md](docs/README.md).

## License

MIT. NOAA model data and separately distributed decoder components retain their own upstream terms and licenses; see [installation and distribution](docs/INSTALL.md) for packaging details.
