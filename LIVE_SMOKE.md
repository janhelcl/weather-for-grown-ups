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

## GEFS ensemble, profile, shared diagnostics, diagnostic series, and aligned GFS comparison integration

```bash
npm run test:live:gefs
```

This is deliberately small. It selects `c00`, `p01`, and `p02`, resolves one current GEFS cycle covering two adjacent native three-hour valid times, and samples data over Prague from the NOAA AWS `pgrb2a` 0.5° product.

The smoke exercises:

- the one-time `GefsEnsembleService` 850-hPa temperature distribution at the final valid time;
- `GefsEnsembleProfileService` over temperature + geopotential height at 850 and 500 hPa, using one multi-message slice per member;
- `GefsLayerDiagnosticsService` for the 850→500-hPa environmental temperature lapse rate using the **same shared pressure diagnostic kernel as GFS**;
- `GefsProfileDiagnosticsService` for freezing-level crossings and sampled inversion layers over 1000/925/850/700/500 hPa, using the **same shared whole-profile diagnostic kernel as GFS** independently for each member;
- a two-step `GefsDiagnosticTimeSeriesService` whole-profile series over those same five pressure levels, proving fixed-cycle temporal composition of member-first structural diagnostics;
- a two-step `GefsEnsembleTimeSeriesService` raw-field distribution using the same explicit model run;
- `GfsGefsComparisonService` at the final valid time, with deterministic GFS and GEFS forced to the same initialization cycle.

It verifies the parts offline fixtures cannot prove:

- current NOAA GFS/GEFS AWS bucket, path, and member naming;
- `.idx` availability and range-aware run discovery;
- single-field and multi-message selected GRIB byte-range download;
- `wgrib2` point decoding of real deterministic GFS and GEFS subsets;
- shared-grid consistency across every field and member inside a GEFS profile while preserving separate GFS/GEFS sampled grid points;
- normalized member values and finite ensemble/profile summaries;
- summary-only profile output by default;
- real member profiles feeding the model-independent layer and whole-profile diagnostic kernels;
- member-specific positive layer depths and finite lapse-rate distribution summaries;
- raw member fractions/count distributions for real freezing/inversion structures;
- conditional structural distributions appearing only when at least one member contains the relevant structure;
- one explicit GEFS cycle/member/diagnostic selection held fixed across adjacent diagnostic time-series steps;
- compact structural summaries changing through time without repeating full member profiles or structures;
- fixed-cycle native three-hour raw-field temporal composition;
- compact summary-only raw-field time-series output by default;
- aligned deterministic-minus-ensemble comparison metrics;
- explicit raw-member / raw-model interpretation semantics rather than calibrated probability or uncertainty.

The live smoke intentionally uses only three GEFS members. The layer check uses two pressure levels; the single-time and two-step whole-profile structural checks use five pressure levels and only temperature/geopotential height. Byte ranges are sequential inside each member while members remain bounded-concurrent. The diagnostic series adds bounded step concurrency around those existing single-time services. The comparison reuses the final scalar GEFS member slices and adds only the matching deterministic GFS field slice.

The 2026-08-23 validation provided a useful sanity check of the temporal semantics. At `f003`, all three selected members contained one freezing-level crossing; the mean lowest-crossing height was about **2943.7 gpm** with population spread about **75.9 gpm**. At `f006`, all three still contained exactly one crossing, but the mean was about **2942.1 gpm** with population spread only **0.94 gpm**. The series therefore preserved both a stable event fraction and a materially changing ensemble structural spread from one fixed initialization cycle.

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

The original deterministic one-profile smoke remains available for targeted debugging:

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

Without `WFG_LIVE_SOURCE` it uses NOMADS; setting `s3` switches the source.

## First scheduled-suite verification

Before the schedule was merged, the expanded deterministic workflow was deliberately executed against current NOAA data on 2026-08-23. The first attempt caught a real test defect: the parcel smoke requested unsupported 875/825/775 hPa levels. The smoke data was corrected to the canonical published GFS pressure-level set, and the rerun passed both AWS and NOMADS paths.

The GEFS point, time-series, profile, and cross-model comparison capabilities were likewise exercised against current NOAA AWS data before merge. The unified-core change extended that same low-cost compatibility check to member-by-member layer diagnostics. GEFS whole-profile diagnostics extended the proof to variable-length structural meteorology: real GEFS multi-message profiles cross the normalized-profile boundary, feed the shared freezing/inversion kernel independently per member, and produce ensemble structural summaries without inventing an ensemble-mean structure. GEFS diagnostic time series now additionally prove that those already-validated single-time summaries can be composed across native forecast times while holding the model cycle, member set, sampling, and diagnostic selection fixed. This layer exists to catch assumptions that deterministic mocks and fixed fixtures cannot reveal without turning upstream availability into a permanent merge dependency.

## Failure triage

A live failure should be classified as one of:

1. upstream publication/network availability;
2. `wgrib2` / runtime environment;
3. WFG integration regression.

Normal deterministic CI remains the merge authority. Live NOAA integration is a low-frequency compatibility signal.
