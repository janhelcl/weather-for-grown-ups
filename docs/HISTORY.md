# Historical GFS analysis and verification

WFG can query historical NOAA GFS model analyses from the NCEI Grid 4 archive, materialize selected profiles for local analog search, and compare archived Grid 4 forecasts with the later analysis at the same valid time. This is separate from the current operational GFS 0.25° forecast surface.

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

- `temperature`
- `relative_humidity`
- `u_wind`
- `v_wind`
- `geopotential_height`
- `vertical_velocity`
- `absolute_vorticity`
- `wind` — derived from U/V
- `dew_point` — derived from temperature/RH
- `potential_temperature` — derived from temperature and pressure

A requested pressure level must actually exist for every requested variable in that historical file. Older GFS files do not expose every modern pressure level for every field; WFG reports missing fields explicitly instead of silently interpolating them.

Older Grid 4 files also use different pressure axes for some variables. WFG groups compatible variables into one NCSS request and fetches incompatible axes separately before merging them by pressure level. For example, temperature, humidity, wind and geopotential height can share the full pressure profile while vertical velocity and absolute vorticity may require their own archive requests.

## Single analysis

### CLI

```bash
wfg history \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 1000,925,850,700,500 \
  --json
```

`--at` must be an exact GFS analysis cycle at 00, 06, 12 or 18 UTC.

### MCP

Tool: `get_gfs_historical_profile`

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "analysisTime": "2017-05-09T12:00:00Z",
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [1000, 925, 850, 700, 500]
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
wfg history-timeseries \
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

Tool: `get_gfs_historical_timeseries`

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "startTime": "2017-05-09T00:00:00Z",
  "endTime": "2017-05-15T23:59:59Z",
  "cycleHoursUtc": [12],
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [850, 700, 500],
  "maxSteps": 7
}
```

## Materialized history and analog search

Analog search does **not** scan years of NCEI files during one agent call. Historical profiles are first materialized into a deliberately simple local JSONL index. Each build call uses the same bounded archive access as `history-timeseries`, so the caller grows the index incrementally rather than triggering an accidental long-running archive crawl.

By default the index lives at:

```text
~/.cache/wfg/history-index/profiles.jsonl
```

`WFG_CACHE_DIR` moves the normal WFG cache root. `WFG_HISTORY_INDEX_PATH` can point the history index at a specific JSONL file. The store is append-only; semantic duplicate records are deduplicated when read, and normal materialization avoids appending a duplicate that already exists.

A semantic record key consists of the analysis time, sampled Grid 4 point and normalized variable/pressure selection. Analog candidates must match the target's **same sampled grid point and same selection**. This prevents apparently similar profiles from different locations or different feature sets from being mixed silently.

### Build the index

CLI:

```bash
wfg history-index \
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

MCP tool: `materialize_gfs_history_index`

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "startTime": "2017-05-01T00:00:00Z",
  "endTime": "2017-05-08T23:59:59Z",
  "cycleHoursUtc": [12],
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [850, 700, 500],
  "maxSteps": 8
}
```

Repeated calls can materialize adjacent ranges. Archive access remains serial and subject to WFG's NOAA courtesy limiter; already cached NCEI responses remain cheap to reuse.

### Find analogs

CLI:

```bash
wfg history-analogs \
  --lat 50.08 \
  --lon 14.43 \
  --target 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --count 5 \
  --exclude-within-hours 24 \
  --json
```

MCP tool: `find_gfs_historical_analogs`

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "targetTime": "2017-05-09T12:00:00Z",
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [850, 700, 500],
  "count": 5,
  "excludeWithinHours": 24,
  "fetchTargetIfMissing": true
}
```

Candidate search is local. If the target analysis itself is not materialized and `fetchTargetIfMissing=true`, WFG fetches only that one target profile, stores it, then searches the local candidate set. Set `fetchTargetIfMissing=false` (CLI: `--no-fetch-target`) for a strictly offline lookup.

Similarity uses **standardized Euclidean distance** over the selected pressure-level values. Feature scales are estimated from the target plus eligible local candidates so temperature, geopotential height and other differently scaled quantities do not compete in raw units. For `wind`, WFG uses the underlying **U/V components**, not direction degrees, avoiding the artificial discontinuity between directions such as 359° and 1°. If `wind` and `u_wind`/`v_wind` are selected together, duplicate component features are included only once.

The returned distance is a model-state similarity score only. It is not a climatological percentile, a probability, or a statement that two days produced the same surface impacts.

## Archived forecast verification

Verification compares **one archived Grid 4 forecast** with the later Grid 4 analysis on the same 0.5° grid point and valid time. This deliberately keeps the primitive atomic: one tool call verifies one lead. An agent can compose calls for 24/48/72-hour comparisons when it actually needs a verification curve, without every request automatically becoming several throttled archive reads.

The input is anchored on the historical `validTime`; WFG derives the forecast run as `validTime - leadHours`. `leadHours` must be a multiple of 6 and is bounded to **0–192 hours**, so the verification target is always a native analysis cycle.

Changes are reported as **analysis − forecast**. Directional quantities such as wind direction use signed circular-degree differences rather than naïve subtraction.

### CLI

```bash
wfg history-verify \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2019-12-26T18:00:00Z \
  --lead-hours 54 \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 850,700,500 \
  --json
```

### MCP

Tool: `verify_gfs_historical_forecast`

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "validTime": "2019-12-26T18:00:00Z",
  "leadHours": 54,
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [850, 700, 500]
}
```

The result contains both normalized profiles, exact forecast and analysis dataset paths, cache status and per-pressure-level numeric changes.

NCEI documents Grid 4 forecast history beginning in 2006, but continuously online THREDDS availability is more limited than the analysis archive; older forecast data may require retrieval through NCEI HAS. WFG surfaces this distinction explicitly when an archived forecast is not available online.

Verification is against **GFS analysis, not observations**. It answers how a forecast differed from the model's later assimilated state. It does not measure observational error, and long-period comparisons must account for changes in historical GFS versions.

## Data access and caching

WFG uses NCEI's THREDDS NetCDF Subset Service (NCSS) in grid-as-point mode. Queries request selected pressure profiles at one point rather than downloading full historical GRIB files. Compatible variables are bundled together; variables using different historical pressure axes are fetched separately and merged locally.

Historical responses are cached because archive files are immutable. Cache misses use WFG's file-based NOAA request throttle; the default cooldown remains 11 seconds. Analysis time series, history materialization and forecast verification are therefore serial rather than bursty.

The analog index is intentionally source-agnostic. Today it is populated through the NCEI profile surface; a future bulk historical source can write the same normalized records without changing analog-search semantics.

Analysis archive naming changes around June 2020: WFG handles historical `gfsanl_4_...` files and later `gfs_4_...` analysis files. Forecast history similarly handles `model-gfs-004-files-old` before June 2020 and `model-gfs-004-files` afterward.

## What comes next

The history surface deliberately separates model history from climatology. Natural follow-ons are:

1. faster/bulk index ingestion so years of candidate history can be built efficiently without interactive NCSS calls;
2. anomaly and percentile calculations against a deliberately chosen homogeneous reanalysis/climatology source;
3. optional seasonal or impact-specific analog filters built on top of the generic model-state metric;
4. multi-lead verification summaries once archive caching/indexing makes them efficient.
