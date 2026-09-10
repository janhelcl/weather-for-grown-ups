# Alignment: `wfg align` / `align_atmosphere`

Alignment is WFG's one composition primitive for putting several sources of atmospheric evidence side by side. It replaces the earlier `compare-runs` / `compare-datasets` verbs and their hand-maintained pair registry.

The contract is deliberately small:

- **You ask one question** — one point, one valid time or range, one canonical selection — **of several sources.**
- **A source is the dataset-specific part of a `query_atmosphere` request**: `dataset` plus its own `forecast` (run / kind / grid), `ensemble` (members / quantiles) and GFS `source` modifiers. Nothing else.
- **WFG returns the evidence as one table** keyed by canonical quantity and valid time, with the provenance and the alignment rules needed to read it.
- **WFG does not compute or interpret differences.** Which guidance is warmer, whether two models disagree, whether a run trend matters — those are the caller's statements.

Because a source is just a dataset selector, every former comparison shape is the same call:

| Question | Sources |
| --- | --- |
| Run-to-run trend of one model | `gfs`, `gfs@2026-09-09T18:00:00Z`, `gfs@2026-09-09T12:00:00Z` |
| Physics vs AI | `gfs`, `aigfs` or `ifs`, `aifs` |
| Deterministic inside its ensemble | `ifs`, `ifs-ens` or `gfs`, `gefs` |
| Global vs regional | `ifs`, `icon-d2`, `arome` |
| Two member subsets of one ensemble | `gefs;members=c00,p01,p02`, `gefs;members=p03,p04,p05` |
| Hybrid vs constituents | `hgefs`, `gefs`, `aigefs` |

No dataset pair needs registering. Whether a source can serve the request is decided by the same per-dataset capability validation `query_atmosphere` uses, and reported per source.

## Request

```jsonc
{
  "sources": [
    { "dataset": "gfs" },
    { "dataset": "gfs", "forecast": { "run": "2026-09-09T18:00:00Z" } },
    { "dataset": "ifs" },
    { "dataset": "ifs-ens", "ensemble": { "quantiles": [0.1, 0.5, 0.9] }, "label": "ens" },
    { "dataset": "icon-d2" }
  ],
  "geometry": { "type": "point", "latitude": 50.08, "longitude": 14.43 },
  "time": { "at": "2026-09-10T12:00:00Z" },          // or { "from", "to", "maxSteps" }
  "selection": {
    "variables": ["temperature", "wind"], "pressureLevelsHpa": [850, 500],
    "fields": ["temperature_2m", "wind_10m"]
  },
  "alignment": { "initialization": "independent", "validTimes": "intersection" }
}
```

- `sources`: 2–8 entries. Duplicate selections and duplicate labels are rejected. `ensemble.includeMembers` / `maxMemberSamples` are not applicable (alignment returns compact member-first distributions).
- `geometry`: point only. Alignment is the smallest boundary that needs a join; spatial shapes stay on `query_atmosphere`.
- `time` and `selection` are exactly the `query_atmosphere` schemas.
- `alignment.initialization`
  - `independent` (default): every source resolves its own run; the result lists them and reports `sharedInitialization`.
  - `shared`: every forecast source must resolve to one initialization cycle, otherwise the request fails with `INVALID_REQUEST`, the resolved runs and a `suggestedRun` to pin.
- `alignment.validTimes` (ranges)
  - `intersection` (default): only valid times sampled by every successful source.
  - `union`: every sampled valid time; a source without a native step at that time gets a `valid_time_not_sampled` cell.

CLI form:

```bash
wfg align --lat 50.08 --lon 14.43 --at 2026-09-10T12:00:00Z \
  --source gfs --source gfs@2026-09-09T18:00:00Z --source ifs \
  --source "ifs-ens;quantiles=0.1,0.5,0.9;label=ens" --source icon-d2 \
  --vars temperature,wind --levels 850,500 --fields temperature_2m,wind_10m --json
```

`--source` grammar: `dataset[@run][;key=value...]` with keys `run`, `members`, `quantiles`, `label`, `grid` (GFS `0p25|0p50`), `kind` (`operational|reforecast`), `source` (`nomads|s3|archive`). A top-level `--quantiles` is applied to every ensemble source that does not set its own.

## Result

```jsonc
{
  "operation": "align_atmosphere",
  "geometry": …, "time": …, "selection": …,
  "alignment": {
    "initialization": "independent",
    "runs": [{ "label": "gfs@latest", "run": "2026-09-10T00:00:00.000Z" }, …],
    "sharedInitialization": false,
    "validTimes": "intersection",
    "spatial": "each_source_samples_its_own_native_grid_at_the_requested_coordinate_no_regridding",
    "ensembles": "independent_member_first_distributions_no_member_pairing",
    "interpretation": "aligned_raw_model_evidence_not_error_not_calibrated_uncertainty"
  },
  "sources": [
    { "index": 0, "label": "gfs@latest", "dataset": "gfs", "status": "ok",
      "internalDatasetId": "gfs_0p25", "role": "forecast", "kind": "deterministic",
      "modelClass": "physics", "provider": "noaa", "run": "…", "gridPoint": { "latitude": 50, "longitude": 14.5 },
      "spatialDomain": …, "nativeGrid": …, "steps": [{ "validTime": "…", "forecastHour": 12 }], "source": … },
    { "index": 3, "label": "ens", "dataset": "ifs-ens", "status": "ok", "kind": "ensemble", "memberCount": 50, … },
    { "index": 4, "label": "icon-d2", "dataset": "icon-d2", "status": "failed",
      "failure": { "code": "OUT_OF_DOMAIN", "message": "…", "retryable": false } }
  ],
  "quantities": [
    {
      "selection": { "kind": "pressure", "variable": "temperature", "pressureLevelHpa": 850 },
      "output": { "field": "temperatureC", "unit": "degC", "deltaKind": "linear" },
      "series": [
        { "validTime": "2026-09-10T12:00:00.000Z", "comparable": true,
          "values": [
            { "kind": "value", "value": 6.22 },
            { "kind": "value", "value": 5.39 },
            { "kind": "value", "value": 5.63 },
            { "kind": "distribution", "memberCount": 50, "mean": 5.75, "populationStdDev": 0.39, "min": 5.09, "max": 6.7,
              "quantiles": [{ "quantile": 0.1, "value": 5.3 }, …] },
            { "kind": "unavailable", "reason": "source_failed" }
          ] }
      ]
    },
    {
      "selection": { "kind": "pressure", "variable": "wind", "pressureLevelHpa": 850 },
      "output": { "field": "windDirectionDeg", "unit": "degree", "deltaKind": "circular_degrees" },
      "series": [ { "values": [ …, { "kind": "circular_direction", "memberCount": 50, "meanDirectionDeg": 283.5, "resultantLength": 0.99 }, … ] } ]
    }
  ]
}
```

`quantities[i].series[j].values[k]` is the cell for source `k` — the column order is exactly `sources`.

### What WFG decides for you

- **Canonical quantity, unit and delta semantics.** Every cell in a column shares `output.unit`. `deltaKind: circular_degrees` marks quantities where a naive subtraction is wrong (wind direction); everything else is `linear`.
- **Temporal comparability.** Accumulated/averaged/maximum fields carry their `window`. A step is `comparable: false` with `reason: temporal_windows_differ` when successful sources report different windows for the same valid time (e.g. a since-analysis vs a since-last-step precipitation accumulation). WFG never rebases accumulations.
- **Provenance.** Resolved run, lead (`forecastHour`), sampled `gridPoint`, `nativeGrid`, `spatialDomain`, `memberCount`, `modelClass`, `provider` and the transport `source` are attached per source.
- **Spatial rule.** Each source samples its own native grid at the requested coordinate. There is no regridding; `gridPoint` tells you how far apart the sampled points are.
- **Ensemble rule.** Ensembles are independent member-first distributions. Member labels are never paired across sources or cycles.

### What WFG leaves to you

- Differences, ranks, spread comparisons, run trends and any verdict.
- Whether a difference is meaningful. `interpretation` is a literal reminder that the table is raw model evidence, not error and not calibrated uncertainty.

## Failure model

- Requests are validated once as a whole. Source-specific problems are reported at `sources[i].…` with the same messages `query_atmosphere` would give (`at sources.1.forecast.run: dataset=gefs does not support run=latest_complete`).
- A source that fails at retrieval is reported inline with its public failure (`INVALID_REQUEST`, `OUT_OF_DOMAIN`, `DATA_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`, …); its column becomes `unavailable / source_failed`. WFG never substitutes a different dataset or trims the selection to make a source pass.
- The request as a whole fails only if every source failed (the first source's code is used) or if `initialization: shared` is violated.
- Over MCP, embedded `INTERNAL_ERROR` messages are redacted exactly like top-level ones.

## Execution

Sources are fetched with bounded concurrency (`DEFAULT_ALIGNMENT_SOURCE_CONCURRENCY = 4`) through the same `UnifiedAtmosphereQueryService` every caller uses; each source therefore keeps its own provider access ceiling, cache and member-first ensemble execution. Alignment adds no provider traffic beyond the N underlying queries and no additional decoding.

## Where it lives

- `src/schema/unified-alignment.ts` — request/result contract; reuses `validateDatasetModifiers` from the query schema for each source.
- `src/core/atmospheric-evidence.ts` — normalizes heterogeneous point results (deterministic levels/fields, the three native ensemble summary packagings, ranges, analysis times) into canonical cells.
- `src/core/unified-atmosphere-alignment.ts` — fan-out, valid-time axis, comparability flags, provenance.
- Surfaces: `wfg align` (`src/cli/unified-atmosphere-command.ts`) and `align_atmosphere` (`src/mcp-unified-tool.ts`).
