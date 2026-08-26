# GEFS transects

WFG supports ensemble-native atmospheric cross-sections along a great-circle path through the same public `transect` operation used by deterministic GFS.

## Contract

GEFS transects use the operational 0.5° `pgrb2a` product and support the same mixed GEFS bundle selection used by `ensemble-fields` and `ensemble-fields-points`:

- pressure-level variables and supported member-first derived thermodynamics;
- supported non-isobaric `pgrb2a` fields such as 2 m temperature/RH, 10 m wind, precipitation, PWAT, cloud cover, CAPE/CIN and MSLP;
- explicit member selection (`c00`, `p01`–`p30`);
- ensemble quantiles;
- optional memberwise audit values.

The default result contains one ensemble distribution per requested output at each path sample. Raw member arrays are opt-in and guarded by `maxMemberSamples`.

## Geometry and efficiency

Great-circle interpolation and distance calculations are model-independent and are shared directly with the deterministic GFS transect implementation.

A GEFS transect is then executed as **one multi-point mixed-bundle query** for the complete path. WFG therefore fetches one immutable selected-message file per member and reuses it across all transect samples.

Upstream selected-file work scales with:

`members`

rather than:

`members × transect samples`

Local `wgrib2` point extraction remains sample-oriented. GEFS transects currently allow 2–20 samples, matching the proven GEFS mixed multi-point batch bound. GFS keeps its independent 2–50 sample contract.

## CLI

```bash
wfg transect \
  --model gefs \
  --start 50.08,14.43 \
  --end 49.20,16.61 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m \
  --members c00,p01,p02,p03 \
  --quantiles 0.1,0.5,0.9 \
  --samples 10 \
  --json
```

GFS remains the default model. Its existing pressure-level transect behavior and 21-sample default are preserved.

## MCP

`get_gefs_transect` exposes the same core service through both stdio and Streamable HTTP MCP transports.

## Ensemble semantics

All nonlinear derived quantities are evaluated member by member before aggregation. Wind direction uses circular aggregation. Accumulation and average intervals remain explicit for fields with temporal semantics.

Member fractions and spread are raw model-member evidence. WFG does not label them as calibrated real-world probability or uncertainty.

## Live smoke

`npm run test:live:gefs` includes a compact live transect smoke using two members, three path samples, one pressure level and two non-isobaric fields. Normal CI remains offline/deterministic and does not depend on NOAA availability.
