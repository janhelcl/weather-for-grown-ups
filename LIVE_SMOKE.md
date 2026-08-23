# Opt-in live NOAA smoke tests

WFG's normal test suite is deterministic and offline. Live smoke tests are separate, opt-in integration checks for the real NOAA upstreams and local `wgrib2` installation.

They are intentionally **not part of normal CI** because upstream availability, forecast publication timing, network latency, and the NOMADS courtesy delay would make ordinary verification slow and non-deterministic.

## Requirements

- internet access;
- `wgrib2` on `PATH`, or `WGRIB2_PATH` set;
- the same Node.js requirements as WFG.

All suites first resolve the latest GFS cycle published through `f384`, then use that explicit run for the rest of the suite so the model cycle cannot change halfway through a test.

## Existing single-profile smoke

```bash
npm run test:live
WFG_LIVE_SOURCE=s3 npm run test:live
```

This preserves the original compact point-profile smoke. Without `WFG_LIVE_SOURCE`, it uses NOMADS; the environment variable can switch it to S3.

## Expanded S3 integration smoke

```bash
npm run test:live:s3
```

This exercises several shared-core compositions against NOAA AWS Open Data:

- a three-location batched query with pressure levels and non-isobaric fields;
- a four-step native point time series (`f006` through `f009`);
- a five-sample pressure-level great-circle transect;
- a real surface-parcel LCL/CAPE/CIN calculation from an S3-backed profile.

Assertions intentionally validate contracts and physical-result finiteness rather than expecting specific weather values. The suite uses explicit run timestamps after initial discovery and benefits from WFG's immutable selected-message cache.

## Rich NOMADS area smoke

```bash
npm run test:live:area
```

This performs one small Central-European `temperature_2m` area request at `f006` and asks for:

- p10 / p50 / p90;
- fraction of defined grid cells at or above 0 °C;
- min/max representative coordinates and tie counts.

It therefore exercises the real NOMADS geographic-subset path, exact non-isobaric field selection, Kelvin-to-Celsius normalization, and the opt-in bounded `wgrib2 -spread -` calculation path.

This suite makes one physical NOMADS fetch when the GRIB slice is not already cached. It uses the same shared conservative **11-second post-request cooldown** as every other NOMADS call; no smoke-test bypass exists.

## Run both expanded suites

```bash
npm run test:live:all
```

This runs the S3 integration suite followed by the rich NOMADS area suite.

## What normal CI checks

Normal `npm run typecheck` now compiles both `src/**/*.ts` and `scripts/**/*.ts` through separate TypeScript configurations. This catches API drift and script errors without contacting NOAA. Normal CI still does **not** execute the live scripts.

A live smoke failure should be triaged as either:

1. an upstream/publication/network problem;
2. a local `wgrib2`/environment problem; or
3. a WFG integration regression.

The deterministic offline suite remains the authority for merge gating; live smoke exists to catch assumptions that mocks and fixed fixtures cannot validate.
