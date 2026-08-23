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

## Expanded S3 integration

```bash
npm run test:live:s3
```

This exercises NOAA AWS Open Data through the shared core:

- three-location batched pressure/non-isobaric query;
- four native forecast steps (`f006` through `f009`);
- five-sample pressure-level great-circle transect;
- surface-parcel LCL/CAPE/CIN calculation.

Assertions validate contracts, provenance, dimensions, and physical-result finiteness rather than pinning specific weather values.

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

Run both expanded integrations:

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

Before the schedule was merged, the expanded workflow was deliberately executed against current NOAA data on 2026-08-23. The first attempt caught a real test defect: the parcel smoke requested unsupported 875/825/775 hPa levels. The smoke data was corrected to the canonical published GFS pressure-level set, and the rerun passed both AWS and NOMADS paths.

That is the purpose of this layer: catch assumptions that deterministic mocks and fixed fixtures cannot reveal without turning upstream availability into a merge dependency.

## Failure triage

A live failure should be classified as one of:

1. upstream publication/network availability;
2. `wgrib2` / runtime environment;
3. WFG integration regression.

Normal deterministic CI remains the merge authority. Live NOAA integration is a low-frequency compatibility signal.
