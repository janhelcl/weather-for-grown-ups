# Historical GFS analysis and verification

WFG treats historical NOAA GFS Grid 4 analysis as another dataset in the same atmospheric query engine used by operational GFS and GEFS. Shared operations and meteorological kernels are reused where the archived quantity is physically comparable, while analysis time, 0.5° sampling, NCEI provenance and archive-access constraints remain explicit. History also adds analysis-native composition such as analog search and archived forecast verification.

## What this is

The history surface exposes **GFS Grid 4 fields on the 0.5° grid**. Analysis history uses exact 00, 06, 12 and 18 UTC cycles; NCEI's Grid 4 analysis archive begins in 2007.

An analysis is the model's assimilated atmospheric state at the analysis time. It is useful for questions such as:

- What did the GFS analysis show over Prague at 850 hPa on a historical day?
- What did the vertical temperature, humidity and wind profile look like during a past event?
- Which already materialized historical days had the most similar atmospheric profile over Prague?
- What did GFS predict 24, 48 or 72 hours before a known event, and how did that forecast differ from the later analysis?

It is **not** a direct observation, and the long GFS record is **not a homogeneous climatological reanalysis**. Model versions, assimilation systems and available fields changed over time. WFG labels the products explicitly rather than presenting them as climatology or observations.

## Supported variables

The history surface intentionally uses a stable subset of the long archive:

- raw/stable archive quantities: `temperature`, `relative_humidity`, `u_wind`, `v_wind`, `geopotential_height`, `vertical_velocity`, `absolute_vorticity`, `cloud_water_mixing_ratio`, `ozone_mixing_ratio`;
- moisture reconstructed where needed: `specific_humidity`;
- shared deterministic derivations: `wind`, `dew_point`, `potential_temperature`, `mixing_ratio`, `virtual_temperature`, `air_density`, `wet_bulb_temperature`, and `equivalent_potential_temperature`.

A requested pressure level must actually exist for every requested variable in that historical file. Older GFS files do not expose every modern pressure level for every field; WFG reports missing fields explicitly instead of silently interpolating them.

Older Grid 4 files also use different pressure axes for some variables. WFG groups compatible variables into one NCSS request and fetches incompatible axes separately before merging them by pressure level. For example, temperature, humidity, wind and geopotential height can share the full pressure profile while vertical velocity and absolute vorticity may require their own archive requests.

## Single analysis

### CLI

```bash
wfg query \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 1000,925,850,700,500 \
  --json
```

`--at` must be an exact GFS analysis cycle at 00, 06, 12 or 18 UTC.

### MCP

Tool: `query_atmosphere`

```json
{
  "dataset": "gfs-analysis",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": { "at": "2017-05-09T12:00:00Z" },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
    "pressureLevelsHpa": [1000, 925, 850, 700, 500]
  }
}
```

The result includes the requested point, sampled 0.5° grid point, normalized profile values, exact NCEI dataset path, cache status, and the analysis/climatology caveat.

## Historical time series

Historical ranges are deliberately bounded because the NCEI archive is file-oriented: each selected analysis cycle is a separate immutable archive file. WFG exposes two controls rather than allowing an unbounded archive scan:

- `cycleHoursUtc` / `--cycles` chooses which native 00, 06, 12 and 18 UTC analyses to sample;
- `maxSteps` / `--max-steps` caps the number of selected analyses before any archive request starts.

The default maximum is **8 analyses** and the hard maximum is **16**. Sparse selection is useful for comparable daily samples; choosing only 12 UTC gives one profile per day instead of four.

Archive cycles are fetched serially. Each step keeps its own exact archive dataset path and cache-hit flag.

### CLI

```bash
wfg query \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --from 2017-05-09T00:00:00Z \
  --to 2017-05-15T23:59:59Z \
  --cycles 12 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --max-steps 7 \
  --json
```

### MCP

Tool: `query_atmosphere`

```json
{
  "dataset": "gfs-analysis",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "from": "2017-05-09T00:00:00Z",
    "to": "2017-05-15T23:59:59Z",
    "hoursUtc": [12],
    "maxSteps": 7
  },
  "selection": {
    "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
    "pressureLevelsHpa": [850, 700, 500]
  }
}
```

## Shared diagnostic and spatial operations

Historical analysis now participates in the same core operation vocabulary as operational data for diagnostic series and bounded spatial composition.

### Diagnostic time series

CLI: `diagnose --dataset gfs-analysis`  
MCP: `diagnose_atmosphere`

One selection may be a pressure-layer diagnostic, whole-profile diagnostic, or parcel diagnostic. The same physical kernels are evaluated at each selected 00/06/12/18 UTC analysis cycle. Results use `analysisTime`; WFG does not synthesize forecast initialization or lead-hour fields for analysis data.

### Multiple points

CLI: `query --dataset gfs-analysis --point ...`  
MCP: `query_atmosphere`

Up to **10 points** may be queried at one analysis time. Pressure variables and the supported historical non-isobaric fields can be combined in the same request. Each result preserves requested coordinates, sampled 0.5° grid coordinates, dataset path and cache status.

NCEI Grid 4 access is currently point-oriented. Historical multi-point queries therefore compose **serial NCSS point reads** under the NOAA courtesy limiter. They deliberately do not claim the shared-file reuse semantics available to operational GFS/GEFS on AWS.

### Multiple points over time

CLI: `query --dataset gfs-analysis --point ... --from ... --to ...`  
MCP: `query_atmosphere`

This composes the same multi-point selection across selected analysis cycles. Both the number of cycles and the total **point × analysis-step** matrix are bounded before archive access begins.

### Transects

CLI: `query --dataset gfs-analysis --start ... --end ...`  
MCP: `query_atmosphere`

Historical transects use the **same great-circle interpolation** as operational GFS and GEFS, then delegate all samples to the historical multi-point primitive. Because the NCEI path is point-oriented, historical transects are bounded to **10 samples**.

### Area statistics

CLI: `query --dataset gfs-analysis --west ... --east ... --south ... --north ...`  
MCP: `query_atmosphere`

Historical area summaries use **one native NCEI NCSS bbox/grid subset** over the 0.5° Grid 4 analysis. WFG returns the unweighted defined-grid-point mean, minimum and maximum, with optional spatial percentiles, threshold fractions and representative extrema locations using the same distribution kernel as operational deterministic GFS.

Pressure-level selections are raw archive variables at one explicit pressure surface. Height-above-ground fields use the corresponding NCSS vertical coordinate. NCSS may otherwise choose the nearest vertical level, so WFG verifies the coordinate returned in the CSV and fails if it differs from the requested pressure/height instead of silently substituting a neighboring level.

Derived vector/thermodynamic fields are deliberately excluded from this first area surface. Historical area queries therefore make one archive request rather than joining several full grids or fanning out into point requests.

Example:

```bash
wfg query \
  --dataset gfs-analysis \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --percentiles 10,50,90 \
  --gte 15 \
  --extrema \
  --json
```

The MCP `query_atmosphere` operation accepts the same area geometry, valid time, scalar pressure-variable or field selection, and optional distribution controls.

## Materialized history and analog search

Analog search does **not** scan years of NCEI files during one agent call. Historical profiles are first materialized into a deliberately simple local JSONL index.

By default the index lives at:

```text
~/.cache/wfg/history-index/profiles.jsonl
```

`WFG_CACHE_DIR` moves the normal WFG cache root. `WFG_HISTORY_INDEX_PATH` can point the history index at a specific JSONL file. The store is append-only; semantic duplicate records are deduplicated when read, and normal materialization avoids appending a duplicate that already exists.

A semantic record key consists of the analysis time, sampled Grid 4 point and normalized variable/pressure selection. Analog candidates must match the target's **same sampled grid point and same selection**. This prevents apparently similar profiles from different locations or different feature sets from being mixed silently.

### Build a small index range

`wfg index build` is the bounded interactive primitive. It uses the same 16-analysis maximum as interactive historical time-series queries.

```bash
wfg index build \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --from 2017-05-01T00:00:00Z \
  --to 2017-05-08T23:59:59Z \
  --cycles 12 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --max-steps 8 \
  --json
```

Index construction is CLI-only administration and is not exposed as an MCP weather tool.

### Backfill a large range

`wfg index backfill` is the resumable corpus-building primitive. It can plan up to **50,000 selected cycles**, but each invocation has a separate fetch budget: **16 missing profiles by default, 256 maximum**. Profiles that already exist for the sampled Grid 4 cell and normalized selection are removed from the plan before any archive call.

```bash
wfg index backfill \
  --dataset gfs-analysis \
  --lat 50.08 \
  --lon 14.43 \
  --from 2007-01-01T00:00:00Z \
  --to 2026-08-01T23:59:59Z \
  --cycles 12 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --max-fetches 32 \
  --json
```

Backfill is CLI-only administration and is not exposed as an MCP weather tool.

The result reports `selectedCycleCount`, `alreadyMaterialized`, fetch attempts, cache hits versus upstream reads, newly materialized profiles, failures, `remaining`, and `nextAnalysisTime`. Repeating the same request therefore resumes from the local index without the caller maintaining a cursor.

Useful controls:

- `dryRun=true` / `--dry-run` plans the corpus without archive access or writes;
- `order="newest_first"` / `--newest-first` fills recent history first;
- `continueOnError=true` / `--continue-on-error` records isolated archive gaps and keeps using the current fetch budget;
- a default run stops on the first profile/archive error so a schema or field-regime problem does not silently burn through hundreds of requests.

This is **resumable bulk orchestration, not parallel archive scraping**. NCEI Grid 4 analysis is file-oriented, so a missing daily 12 UTC profile still requires an exact archive profile request. WFG keeps those reads serial and under the existing NOAA courtesy limiter. Raw NCEI responses are immutable and cached, so an interrupted run can reuse already downloaded responses even if the final JSONL append did not happen.

NOAA ARL also publishes a quarter-degree GFS archive from June 2019, but that dataset is constructed from short-term forecasts rather than GFS analyses. WFG deliberately does not substitute it into the `gfs_grid4_analysis_0p5` index. Preserving provenance and analysis semantics is more important than making a backfill look faster.

### Find analogs

```bash
wfg analogs \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --count 5 \
  --exclude-within-hours 24 \
  --json
```

MCP tool: `find_analogs`.

Candidate search is local. If the target analysis itself is not materialized and `fetchTargetIfMissing=true`, WFG fetches only that one target profile, stores it, then searches the local candidate set. Set `fetchTargetIfMissing=false` (CLI: `--no-fetch-target`) for a strictly offline lookup.

Similarity uses **standardized Euclidean distance** over the selected pressure-level values. Feature scales are estimated from the target plus eligible local candidates so temperature, geopotential height and other differently scaled quantities do not compete in raw units. For `wind`, WFG uses the underlying **U/V components**, not direction degrees, avoiding the artificial discontinuity between directions such as 359° and 1°. If `wind` and `u_wind`/`v_wind` are selected together, duplicate component features are included only once.

The returned distance is a model-state similarity score only. It is not a climatological percentile, a probability, or a statement that two days produced the same surface impacts.

## Archived forecast verification

The default verification mode compares **one archived Grid 4 forecast** with the later Grid 4 analysis on the same 0.5° grid point and valid time. This deliberately keeps the primitive atomic: one tool call verifies one lead. An agent can compose calls for 24/48/72-hour comparisons when it actually needs a verification curve, without every request automatically becoming several throttled archive reads.

The input is anchored on the historical `validTime`; WFG derives the forecast run as `validTime - leadHours`. `leadHours` must be a multiple of 6 and is bounded to **0–192 hours**, so the verification target is always a native analysis cycle.

Changes are reported as **analysis − forecast**. Directional quantities such as wind direction use signed circular-degree differences rather than naïve subtraction.

### CLI

```bash
wfg verify \
  --lat 50.08 \
  --lon 14.43 \
  --at 2019-12-26T18:00:00Z \
  --lead-hours 54 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --json
```

### MCP

Tool: `verify_forecast`

```json
{
  "forecastDataset": "gfs",
  "referenceDataset": "gfs-analysis",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": { "at": "2019-12-26T18:00:00Z" },
  "leadHours": 54,
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [850, 700, 500]
}
```

The result contains both normalized profiles, exact forecast and analysis dataset paths, cache status and per-pressure-level numeric changes.

NCEI documents Grid 4 forecast history beginning in 2006, but continuously online THREDDS availability is more limited than the analysis archive; older forecast data may require retrieval through NCEI HAS. WFG surfaces this distinction explicitly when an archived forecast is not available online.

With `referenceDataset: "gfs-analysis"`, verification is against **GFS analysis, not observations**. It answers how a forecast differed from the model's later assimilated state and long-period comparisons must account for changes in historical GFS versions.

With `referenceDataset: "igra"`, verification instead uses **NOAA IGRA v2.2 radiosonde observations**. WFG selects a nearby or explicit station, retrieves the exact nominal sounding, samples the archived GFS forecast at the sounding launch location, and compares only requested pressure levels that are present exactly in the sounding. It does not vertically interpolate sparse observations. The result reports matched and missing levels, station distance, sounding coordinates, source file and observation-minus-forecast changes. This is a point-observation-versus-model-grid comparison; balloon drift, instrument changes and station relocations remain explicit caveats.

For a bounded skill summary, use a historical range and several lead times in the same `verify_forecast` operation. This range form works with either verification reference. WFG enumerates the selected nominal UTC cycles, samples at most eight times evenly across the period, and permits at most three leads (24 forecast evaluations total). Each successful atomic comparison contributes to lead × pressure × field statistics: sample count, signed bias, MAE and RMSE. Failed archive cases or unavailable soundings remain in the evaluation list, so a field with `count: 5` is never presented as if it had eight comparisons. With `gfs-analysis`, the statistics are native 0.5° Grid 4 analysis-minus-forecast deltas; with `igra`, they are observation-minus-forecast deltas and retain station provenance. Circular wind-direction metrics aggregate shortest signed angular errors.

## Materialized verification corpus

Small interactive skill summaries deliberately remain bounded because live verification fans out into archived forecast plus reference reads. For larger questions, WFG now materializes **atomic verification cases** into a separate append-only JSONL corpus and aggregates them locally.

By default the corpus lives at:

```text
~/.cache/wfg/verification-index/evaluations.jsonl
```

Set `WFG_VERIFICATION_INDEX_PATH` to move it. The corpus is separate from the historical-profile analog index because its semantic key includes verification reference, valid time, forecast lead, request point, selection, and IGRA controls where applicable.

Backfill is resumable and NOAA-paced:

```bash
wfg index verification-backfill \
  --reference igra \
  --lat 50.08 --lon 14.43 \
  --from 2020-01-01T00:00:00Z \
  --to 2025-12-31T23:59:59Z \
  --cycles 12 \
  --lead-hours 24,48,72 \
  --station EZM00011520 \
  --vars temperature,wind \
  --levels 850,700,500 \
  --max-fetches 32 \
  --json
```

Each invocation skips already materialized atomic cases before archive access, then attempts only the configured fetch budget. `--dry-run`, `--newest-first`, and `--continue-on-error` mirror the history backfill controls. The planning limit is 250,000 atomic cases, while one invocation attempts at most 256 missing cases.

Once materialized, multi-year and seasonal skill summaries make **zero upstream requests**:

```bash
wfg index verification-summary \
  --reference igra \
  --lat 50.08 --lon 14.43 \
  --from 2020-01-01T00:00:00Z \
  --to 2025-12-31T23:59:59Z \
  --cycles 12 \
  --months 3,4,5 \
  --lead-hours 24,48,72 \
  --station EZM00011520 \
  --vars temperature,wind \
  --levels 850,700,500 \
  --json
```

The summary uses the same lead × pressure × field bias/MAE/RMSE kernel as interactive verification. It reports expected versus materialized evaluation counts and an explicit coverage rate, so a partially backfilled corpus cannot masquerade as a complete seasonal sample. IGRA summaries also report the actual stations represented. Cases materialized once via nearest-station selection and once via an explicit station are deduplicated by their actual verification identity before aggregation.

The same corpus supports `--reference gfs-analysis`; those records preserve native 0.5° Grid 4 analysis-minus-forecast semantics and are never mixed with observation-minus-forecast IGRA records.

## Data access and caching

WFG uses NCEI's THREDDS NetCDF Subset Service (NCSS). Point/profile queries use grid-as-point mode, requesting selected pressure profiles without downloading full historical GRIB files. Area summaries use NCSS geographic bbox/grid subsets and aggregate the returned cells locally. Compatible point-profile variables are bundled together; variables using different historical pressure axes are fetched separately and merged locally.

Historical responses are cached because archive files are immutable. Cache misses use WFG's file-based NOAA request throttle; the default cooldown remains 11 seconds. Analysis time series, history materialization/backfill and forecast verification are therefore serial rather than bursty.

The analog index remains source-format agnostic at the storage boundary: normalized records are JSONL. A future official bulk **analysis** source could feed the same records without changing analog-search semantics. It must not silently mix forecast, analysis and reanalysis products.

Analysis archive naming changes around June 2020: WFG handles historical `gfsanl_4_...` files and later `gfs_4_...` analysis files. Forecast history similarly handles `model-gfs-004-files-old` before June 2020 and `model-gfs-004-files` afterward.

## What comes next

Historical analysis is now substantially integrated into the common engine. Natural follow-ons are:

1. anomaly and percentile calculations against a deliberately chosen homogeneous reanalysis/climatology source;
2. optional seasonal or impact-specific analog filters built on top of the generic model-state metric;
3. broader station-network and seasonal skill aggregation once a dedicated verification index makes larger samples efficient;
4. an alternative official bulk analysis transport if NOAA exposes one that preserves the same Grid 4 analysis semantics.
