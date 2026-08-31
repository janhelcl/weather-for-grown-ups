# Live NOAA integration tests

WFG keeps real-NOAA checks separate from normal deterministic CI. Upstream publication timing, network availability and NOAA request pacing make live data valuable as a compatibility signal but a poor merge gate.

## Schedule

`.github/workflows/live-noaa.yml` runs the live suite:

- every Monday at **05:17 UTC**;
- on manual `workflow_dispatch`.

It does not run on ordinary pushes or pull requests. A non-cancelling concurrency group prevents overlapping live suites.

The workflow builds the Docker `live-test` target and runs its default command, `npm run test:live:all`.

## What `test:live:all` covers

The current aggregate script runs:

```text
test:live:bundled
test:live:s3
test:live:aigfs
test:live:history
test:live:gefs
test:live:gefs-runs
test:live:area
```

### Bundled decoder

`npm run test:live:bundled` explicitly refuses `WFG_DECODER=wgrib2` and `WGRIB2_PATH`. It verifies the default bundled decoder against real NOAA data for:

- GFS AWS pressure/non-isobaric profile data;
- GFS NOMADS area data with temporal semantics;
- GEFS AWS ensemble data.

This is the live proof that the normal npm path does not require native `wgrib2`.

### GFS AWS

`npm run test:live:s3` exercises deterministic GFS selected-message access and higher-level composition against NOAA AWS Open Data.

### AIGFS

`npm run test:live:aigfs` makes one bounded mixed pressure/surface query through the public `dataset: "aigfs"` path. It verifies the operational NOMADS directory/index format, partial HTTP Range transport, bundled GRIB2 decoding, canonical pressure/surface normalization, derived wind, 6-hour lead semantics and unified result identity. The test deliberately uses a valid time well behind the publication edge so it checks source compatibility rather than racing the newest cycle.

### Historical GFS analysis and forecast skill

`npm run test:live:history` exercises fixed NOAA NCEI Grid 4 data through THREDDS NCSS. It verifies a 2017 historical analysis profile and time series, then an archived 2019 forecast against the later 0.5° analysis and the bounded `gfs-analysis` skill-summary path. The skill smoke reuses the same fixed verification case, so it proves the range aggregation contract without turning the live test into a large archive scan.

### IGRA radiosonde verification

`npm run test:live:igra` selects a recent 12 UTC sounding from Praha-Libuš (`EZM00011520`), reads the official NOAA IGRA v2.2 station ZIP, and verifies a 48-hour archived GFS 0.25° forecast against exact observed pressure levels. It checks observation-minus-forecast output, station metadata and the no-hidden-interpolation contract. IGRA file access and archived NOAA requests share WFG's file-backed courtesy limiter.

`npm run test:live:igra-skill` covers the range form of the same public operation. It samples two recent Praha-Libuš 12Z valid times, evaluates +24 h and +48 h archived GFS forecasts, and requires non-empty count/bias/MAE/RMSE statistics. The script permits an individual upstream case to fail, but failures must remain explicit and at least one evaluation must succeed.

### GFS operational transport parity

`npm run test:live:gfs-operational-parity` compares a recent same-run GFS profile through NOMADS and NOAA AWS for both `0p25` and `0p50`. It is a transport/decoder parity contract for current operational data; it says nothing about the historical archives.

### GFS operational/archive equivalence

`npm run test:live:gfs-archive-equivalence` is archive-only. For each GFS grid it searches selected ages across the NOAA AWS rolling retention window for a run that is also exposed by the matching archive, then compares profile variables, mixed fields, time ranges, multi-point state, layer/profile/parcel diagnostics and area statistics. Source-selectable operational state is read from AWS; the bounded operational area path remains NOMADS-backed. The 0.25° archive is NCAR/GDEX d084001 and the 0.5° archive is NOAA NCEI Grid 4.

The script never substitutes NOMADS-vs-AWS when archive overlap is absent. Instead it emits `archiveStatus: "not_tested_no_overlap"` for that grid. A successful process therefore means either strict numeric/semantic archive parity was exercised or the script explicitly reported that parity could not be tested because upstream overlap was unavailable; inspect the structured summary when archive proof matters.

### GEFS

`npm run test:live:gefs` currently chains bounded live checks for:

- core GEFS ensemble/profile/diagnostic behavior;
- raw GEFS multi-point time series;
- mixed-field GEFS multi-point time series;
- ensemble-native GEFS transects.

The live cases intentionally use small member/point/time selections. Their purpose is to catch source-path, inventory, byte-range, decoding, grid-consistency and composition regressions without treating a tiny member subset as a forecast product.

### GEFS run comparison

`npm run test:live:gefs-runs` verifies distribution evolution across consecutive model initializations while preserving the rule that repeated perturbation labels are not member trajectories across cycles.

### Area summaries

`npm run test:live:area` exercises the bounded NOAA area path and rich spatial statistics.

## NOAA pacing

Physical NOMADS downloads and NCEI historical NCSS cache misses use WFG's shared file-backed courtesy limiter. The default is an **11-second post-request cooldown**, deliberately conservative relative to NOAA's 10-second scripted-request guidance.

NOAA AWS Open Data byte-range access does not use the scripted-request limiter.

## Running locally

With Node.js supported by WFG and internet access:

```bash
npm run test:live:all
```

The normal decoder is bundled with npm, so native `wgrib2` is not required.

To exercise the pinned Docker environment instead:

```bash
docker build --target live-test -t weather-for-grown-ups:live-test .
docker run --rm weather-for-grown-ups:live-test
```

The Docker live-test image contains native `wgrib2 3.8.0` as an available compatibility/debug backend, but the bundled-decoder smoke explicitly verifies the non-native path.

## What live tests assert

Live tests should assert contracts and invariants rather than pinning today's weather. High-value checks include:

- current NOAA paths and inventory formats;
- historical NCEI archive paths and NCSS response formats;
- selected GRIB byte-range access, including AIGFS `.idx` + raw NOMADS HTTP Range reads;
- decoder compatibility with real GFS/GEFS messages;
- requested grid/sample consistency;
- finite normalized physical values;
- fixed-cycle semantics across time;
- upstream slice reuse across coordinates;
- explicit temporal semantics for accumulation/average fields;
- member-first GEFS computation and raw-member interpretation labels.

## Failure triage

A live failure should first be classified as:

1. upstream publication/network availability;
2. decoder/runtime compatibility;
3. WFG integration regression.

Normal offline CI remains the merge authority; the weekly live suite is the upstream-compatibility alarm.
