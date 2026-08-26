# GFS run-to-run comparison

WFG can compare the same point, valid time, and atmospheric selection across consecutive six-hour GFS model cycles. The primitive stays descriptive: it reports snapshots and deterministic numeric changes, but it does not label a forecast as improving, worsening, stable, safe, or unsafe.

## CLI

```bash
wfg compare-runs \
  --lat 50.08 \
  --lon 14.43 \
  --valid 2026-08-24T12:00:00Z \
  --anchor latest \
  --cycles 3 \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --fields temperature_2m,wind_10m,low_cloud_cover \
  --json
```

`--cycles` accepts 2-6 consecutive GFS cycles and defaults to 3. `--anchor` is the newest cycle in the comparison and accepts the same selector family as other WFG surfaces:

- `latest`: newest already-published cycle that satisfies the requested valid time and exact atmospheric selection
- `latest_complete`: newest cycle published through f384
- an explicit 00Z/06Z/12Z/18Z initialization timestamp

Earlier snapshots are exactly six hours apart from the anchor. Runs are returned oldest to newest.

## MCP

MCP exposes the same primitive as `compare_gfs_runs`, with `anchorRun`, `validTime`, `cycles`, and the same pressure-variable/non-isobaric field selection used by point profiles.

The CLI and MCP call the same `RunComparisonService` and validate the same public Zod result contract.

## Delta semantics

Every transition compares one run with the immediately newer run. Numeric deltas are always:

`delta = newer value - older value`

Pressure-level changes are grouped by pressure surface. Each numeric change includes `field`, `from`, `to`, `delta`, and `deltaKind`.

Linear values use `deltaKind="linear"`.

Wind direction uses `deltaKind="circular_degrees"` and the shortest signed angular difference in the range `[-180, 180)`. For example:

- 350° → 10° = +20°
- 10° → 350° = -20°

This avoids the misleading +/−340° changes produced by ordinary subtraction.

## Interval-valued products

Accumulations and forecast-window averages require extra care. Two runs can describe the same valid time while representing different absolute accumulation/average windows.

WFG only emits numeric deltas for interval-valued non-isobaric fields when both snapshots have the same temporal type and the same absolute `startTime` and `endTime`. Otherwise the field is returned with:

- `comparable=false`
- `reason="temporal_windows_differ"`
- an empty `changes` array

This prevents a 24-hour accumulation from one run being subtracted from an 18-hour accumulation from another and presented as forecast trend.

Instantaneous products are directly comparable when their vertical semantics match.

## Data path and concurrency

Run comparison is intentionally S3-only. Comparing multiple GFS cycles concurrently through NOMADS would unnecessarily consume the courtesy-limited request path. Each cycle uses the existing NOAA AWS selected-message byte-range profile path and immutable subset cache.

Cycle fetches use bounded concurrency of four by default.

## Failure behavior

The service fails rather than silently dropping a cycle when:

- one requested comparison cycle is outside the valid GFS forecast horizon
- the exact field selection is unavailable in one cycle
- the profile source changes away from NOAA AWS S3
- the requested point resolves to a different GFS grid point between cycles
- another profile invariant changes unexpectedly

The error identifies the run that could not be compared and the requested valid time.

## Intended agent use

The primitive supports questions such as:

- "How has tomorrow afternoon's 850 hPa wind changed over the last three GFS runs?"
- "Is the latest run shifting the cloud forecast compared with the previous cycles?"
- "Show me the raw forecast evolution for these pressure levels."

Interpretation remains with the calling agent or downstream application rather than being embedded in WFG.
