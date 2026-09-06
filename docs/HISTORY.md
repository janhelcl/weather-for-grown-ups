# Historical GFS analysis and verification

WFG treats historical GFS state as part of the same atmospheric engine as operational forecasts while keeping the scientific meaning explicit.

The two important identities are:

- `dataset: "gfs-analysis"` — the later assimilated/model state on the historical 0.5° Grid 4 product;
- `dataset: "gfs"` with an old explicit `forecast.run` — an archived operational forecast, still identified publicly as GFS.

History is **not** a direct observation surface and the long GFS record is **not a homogeneous climatological reanalysis**. Model and assimilation changes across the record remain a scientific caveat regardless of which transport serves the bytes.

## One historical product, several transports

Grid 4 analysis semantics are provider-neutral above the source layer. WFG routes the same `gfs-analysis` request by era and operation:

- **2021-01-01 onward:** NOAA AWS Open Data 0.50° `f000` with `.idx` byte-range access;
- **2007–2020 point/profile access:** NCEI THREDDS fileServer full-file download plus local decode;
- **2007–2020 area access:** NCEI NCSS, because fileServer cannot subset a geographic box;
- AWS/fileServer routes may fall back to NCSS for eligible data/upstream availability failures.

Public history semantics do not change when the route changes. Results report the provider/access path that actually served the request, along with the provider dataset/object identity and cache status where applicable.

The same Grid 4 routing state machine is reused by archived 0.5° GFS forecasts. Archived 0.25° GFS forecasts use the separate NCAR/GDEX product. See [ARCHITECTURE.md](ARCHITECTURE.md#important-routing-examples) for routing ownership and [UNIFIED_API.md](UNIFIED_API.md) for the public request contract.

## Analysis time semantics

`gfs-analysis` has no forecast initialization or lead axis. Its native time coordinate is an exact analysis cycle at:

- 00 UTC;
- 06 UTC;
- 12 UTC;
- 18 UTC.

The online Grid 4 analysis surface begins in 2007. WFG does not synthesize a forecast run or lead hour for analysis data.

## Supported pressure-profile variables

The historical profile surface intentionally uses a stable subset of the long record.

Raw/archive-backed quantities include:

- `temperature`;
- `relative_humidity`;
- `u_wind`, `v_wind`;
- `geopotential_height`;
- `vertical_velocity`;
- `absolute_vorticity`;
- `cloud_water_mixing_ratio`;
- `ozone_mixing_ratio`.

WFG reconstructs `specific_humidity` where needed and exposes shared deterministic derivations such as `wind`, `dew_point`, `potential_temperature`, `mixing_ratio`, `virtual_temperature`, `air_density`, `wet_bulb_temperature`, and `equivalent_potential_temperature`.

A requested pressure level must exist for the required raw quantity in that historical product. Older GFS files do not expose every modern pressure level/field combination. WFG fails explicitly instead of silently interpolating a missing archive surface.

Different historical variables can use different pressure axes. The history service groups compatible raw dependencies, fetches the required source slices, and merges them by pressure level before shared derivations run. That composition is source-neutral; it is not an NCSS-specific public contract.

For non-isobaric history fields, see [HISTORY_FIELDS.md](HISTORY_FIELDS.md). For parcel diagnostics, see [HISTORY_PARCEL.md](HISTORY_PARCEL.md).

## Query one analysis

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

The result preserves the requested point, sampled 0.5° Grid 4 point, normalized profile, resolved source provenance and the analysis/climatology caveat.

## Historical ranges

Interactive history is deliberately bounded. Range queries expose:

- `hoursUtc` in MCP / `--cycles` in CLI to select native 00/06/12/18 UTC analysis hours;
- `maxSteps` / `--max-steps` to cap the selected analyses before source access begins.

The default maximum is **8 analyses** and the hard maximum is **16**. Selecting only 12 UTC is therefore a convenient way to take one comparable daily sample.

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

Equivalent MCP time selection:

```json
{
  "time": {
    "from": "2017-05-09T00:00:00Z",
    "to": "2017-05-15T23:59:59Z",
    "hoursUtc": [12],
    "maxSteps": 7
  }
}
```

Selected cycles are composed serially. Each step retains its own source/object identity and cache state; composed results retain the route(s) that actually served the request.

## Shared spatial and diagnostic operations

Historical analysis participates in the same public geometry/diagnostic vocabulary where the archived product can satisfy it.

### Diagnostics

CLI: `wfg diagnose --dataset gfs-analysis ...`  
MCP: `diagnose_atmosphere`

Layer, profile and parcel diagnostics reuse the same physical kernels as deterministic operational data. Diagnostic ranges evaluate those kernels at each selected analysis cycle.

### Multiple points

Up to **10 points** can be queried in one historical multi-point request. Pressure variables and supported non-isobaric fields can be combined. WFG composes bounded point requests through the resolved historical source; it does not claim operational-AWS-style shared-slice reuse when the selected historical route cannot provide it.

### Multiple points over time

The same point set can be composed across selected analysis cycles. WFG validates both the number of cycles and the total point × step matrix before archive access begins.

### Transects

Historical transects use the same great-circle interpolation as the forecast datasets and delegate the samples to the historical multi-point primitive. They remain bounded to the historical point limit.

### Area summaries

Area queries operate on one scalar pressure variable or supported field at one analysis time, then reuse the shared deterministic spatial-distribution kernel for mean/min/max and optional percentiles, threshold fractions and extrema locations.

The source route is era-dependent: recent areas can be served by AWS; pre-2021 areas require NCSS because NCEI fileServer has no geographic subset API. Exact vertical-level semantics remain enforced; WFG never substitutes a neighboring pressure/height level silently.

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

## Materialized history and analog search

Analog search does **not** scan years of upstream archive data during one agent call. Historical profiles are materialized into a local JSONL index first.

Default path:

```text
~/.cache/wfg/history-index/profiles.jsonl
```

`WFG_CACHE_DIR` moves the normal cache root. `WFG_HISTORY_INDEX_PATH` can point the history index at a specific JSONL file.

A semantic record key includes analysis time, sampled Grid 4 point and normalized variable/pressure selection. Analog candidates must match the same sampled grid point and same selection.

### Build a small range

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

`index build` uses the same 16-analysis interactive maximum and is CLI-only administration.

### Backfill a larger corpus

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

Backfill can plan up to **50,000 selected cycles**. One invocation attempts **16 missing profiles by default** and at most **256**. Already materialized records are removed from the plan before upstream access.

Useful controls are `--dry-run`, `--newest-first`, and `--continue-on-error`. Backfill is resumable bulk orchestration, not parallel archive scraping: source reads remain bounded/serial while immutable source artifacts are cached independently from the final JSONL index.

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

Candidate search is local. If the target is missing and target fetching is enabled, WFG fetches only that target profile, materializes it, then searches the local candidates.

Similarity uses standardized Euclidean distance over the selected profile features. `wind` contributes U/V components rather than direction degrees, avoiding the 359°/1° discontinuity. The returned distance is model-state similarity, not a climatological percentile, probability or impact equivalence.

## Archived forecast verification

`verify_forecast` compares an archived GFS forecast against either:

- `gfs-analysis` — the later Grid 4 model analysis;
- `igra` — NOAA IGRA v2.2 radiosonde observations.

The public forecast identity remains `gfs`; archive transport is resolved below the verification service.

### Atomic verification

The request is anchored on historical valid time plus `leadHours`. For GFS-analysis verification, changes are **analysis − forecast**. Directional quantities use signed circular-degree differences.

CLI example:

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

MCP equivalent:

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

The result keeps forecast and reference provenance independent. A Grid 4 forecast and Grid 4 analysis can therefore resolve through different provider routes without losing which source actually served either side.

### IGRA reference

With `referenceDataset: "igra"`, WFG selects an explicit or nearby station, retrieves the nominal sounding, samples the archived forecast at the launch location, and compares only requested pressure levels present exactly in the sounding. It does not vertically interpolate sparse observations.

IGRA verification is observation-minus-forecast and preserves station identity, distance, coordinates and source-file provenance. Balloon drift, instrument changes and station relocations remain observational caveats.

### Bounded skill summary

The range form samples at most **8 nominal verification times** and accepts at most **3 leads**, for at most 24 atomic evaluations. Successful cases aggregate count, signed bias, MAE and RMSE by lead × pressure × field. Failed/unavailable cases remain explicit in the evaluation list so sample counts cannot masquerade as complete coverage.

GFS-analysis statistics remain analysis-minus-forecast. IGRA statistics remain observation-minus-forecast. Circular direction errors use shortest signed angular differences.

## Materialized verification corpus

For larger skill questions, WFG materializes atomic verification cases into a separate JSONL corpus.

Default path:

```text
~/.cache/wfg/verification-index/evaluations.jsonl
```

Use `WFG_VERIFICATION_INDEX_PATH` to move it.

Example backfill:

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

Backfill skips already materialized semantic cases before archive access. `--dry-run`, `--newest-first`, and `--continue-on-error` mirror the history-index workflow. The planner is bounded to 250,000 atomic cases; one invocation attempts at most 256 missing cases.

Once materialized, summaries make zero upstream weather requests:

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

The summary reports expected versus materialized evaluation counts and coverage rate. `gfs-analysis` and IGRA records keep separate reference semantics and are never mixed.

## Caching and provenance

Historical provider artifacts are immutable and cached locally. The normalized history/verification indexes are separate application-level stores.

Two rules matter:

1. **Cache identity follows the atmospheric/source product, not one transient endpoint.** A route change must not change the public history meaning.
2. **Provenance follows the route that actually served the request.** `provider`, `access`, dataset/object identity and cache state are retained rather than assuming every Grid 4 request came from NCEI NCSS.

Provider pacing/retry policy is owned by `access/`. Historical composition stays bounded and avoids bursty archive scans regardless of whether a particular step resolves through AWS, fileServer, NCSS, GDEX or IGRA.

## Interpretation caveats

Use history for model-state reconstruction, analog search and forecast verification. Do not silently promote it into climatology.

- `gfs-analysis` is a model analysis, not direct observation.
- The GFS archive spans multiple model and assimilation versions.
- Archived operational forecasts are not a homogeneous reforecast population.
- IGRA is a point observation network, not a gridded analysis.
- Long-period percentiles, trends and return periods need a deliberately chosen homogeneous reanalysis/climatology source.
