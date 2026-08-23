# Live NOAA integration tests

WFG's normal test suite is deterministic and offline. Real NOAA integration checks are deliberately separate because upstream availability, forecast publication timing, network latency, and the NOMADS courtesy delay make them unsuitable as ordinary PR gates.

## Automated schedule

`.github/workflows/live-noaa.yml` runs the expanded suite:

- every Monday at **05:17 UTC**;
- on explicit `workflow_dispatch`.

It does **not** run on normal pushes or pull requests.

The workflow builds the dedicated Docker `live-test` target, which pins Node.js 24 and `wgrib2 3.8.0`, then runs `npm run test:live:all`. Live jobs share one non-cancelling concurrency group so upstream checks never overlap or replace one another.

## Upstream pacing

All physical NOMADS downloads use WFG's normal file-backed limiter. The default is an **11-second post-request cooldown**, deliberately conservative relative to NOAA's 10-second scripted-request guidance. The live suite has no bypass.

AWS Open Data access does not use the NOMADS limiter.

## Expanded deterministic GFS S3 integration

```bash
npm run test:live:s3
```

This exercises NOAA AWS Open Data through the deterministic GFS core:

- three-location batched pressure/non-isobaric query;
- four native forecast steps (`f006` through `f009`);
- five-sample pressure-level great-circle transect;
- surface-parcel LCL/CAPE/CIN calculation.

Assertions validate contracts, provenance, dimensions, and physical-result finiteness rather than pinning specific weather values.

## GEFS ensemble and aligned GFS comparison integration

```bash
npm run test:live:gefs
```

This is deliberately small. It selects `c00`, `p01`, and `p02`, resolves one current GEFS cycle covering two adjacent native three-hour valid times, and samples 850-hPa temperature over Prague from the NOAA AWS `pgrb2a` 0.5° product.

The smoke exercises:

- the one-time `GefsEnsembleService` result at the final valid time;
- a two-step `GefsEnsembleTimeSeriesService` result using the same explicit model run;
- `GfsGefsComparisonService` at the final valid time, with deterministic GFS and GEFS forced to the same initialization cycle.

It verifies the parts offline fixtures cannot prove:

- current NOAA GFS/GEFS AWS bucket, path, and member naming;
- `.idx` availability and range-aware run discovery;
- selected GRIB byte-range download at multiple forecast hours;
- `wgrib2` point decoding of real deterministic GFS and GEFS subsets;
- shared-grid consistency inside GEFS while preserving separate GFS/GEFS sampled grid points;
- normalized member values and finite ensemble summaries;
- fixed-cycle native three-hour temporal composition;
- compact summary-only time-series output by default;
- aligned deterministic-minus-ensemble comparison metrics;
- explicit raw-member / raw-model interpretation semantics rather than calibrated probability or uncertainty.

The live smoke intentionally uses only three GEFS members and two forecast steps so weekly compatibility testing remains light. The comparison reuses the final GEFS member slices and adds only the matching deterministic GFS field slice.

## Rich NOMADS area integration

```bash
npm run test:live:area
```

This performs one small Central-European `temperature_2m` area request at `f006` and requests:

- p10 / p50 / p90;
- fraction of defined grid cells at or above 0 °C;
- representative min/max grid coordinates and tie counts.

It exercises the real NOMADS geographic-subset path, exact field selection, unit normalization, `wgrib2` spread decoding, rich area statistics, and the shared courtesy limiter.

## Run the expanded suite locally

Requirements:

- internet access;
- Node.js supported by WFG;
- `wgrib2` on `PATH`, or `WGRIB2_PATH` set.

Run all expanded integrations:

```bash
npm run test:live:all
```

The Docker target avoids host dependency setup:

```bash
docker build --target live-test -t weather-for-grown-ups:live-test .
docker run --rm weather-for-grown-ups:live-test
```

## Compact legacy profile smoke

The original one-profile smoke remains available for targeted debugging:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

Without `WFG_LIVE_SOURCE` it uses NOMADS; setting `s3` switches the source.

## First scheduled-suite verification

Before the schedule was merged, the expanded deterministic workflow was deliberately executed against current NOAA data on 2026-08-23. The first attempt caught a real test defect: the parcel smoke requested unsupported 875/825/775 hPa levels. The smoke data was corrected to the canonical published GFS pressure-level set, and the rerun passed both AWS and NOMADS paths.

The GEFS point and time-series capabilities were likewise exercised against current NOAA AWS data before merge. Cross-model comparison extends that same low-cost compatibility check to the aligned deterministic GFS slice. This layer exists to catch assumptions that deterministic mocks and fixed fixtures cannot reveal without turning upstream availability into a permanent merge dependency.

## Failure triage

A live failure should be classified as one of:

1. upstream publication/network availability;
2. `wgrib2` / runtime environment;
3. WFG integration regression.

Normal deterministic CI remains the merge authority. Live NOAA integration is a low-frequency compatibility signal.
