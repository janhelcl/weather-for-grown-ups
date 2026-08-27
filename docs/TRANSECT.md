# Deterministic GFS pressure-level transects

WFG exposes a deterministic pressure-level cross-section primitive for agents that need atmospheric structure along a path rather than at one point or over a rectangular area.

Selecting `dataset=gefs` gives ensemble-native mixed-field transects; selecting `dataset=gfs-analysis` gives historical analysis transects where supported. This document focuses on deterministic GFS.

## CLI

```bash
wfg transect \
  --model gfs \
  --start 50.08,14.43 \
  --end 47.27,11.40 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --samples 21 \
  --json
```

## MCP

MCP uses `query_atmosphere` with `geometry.type="transect"` and `dataset="gfs"`.

The request contains start/end coordinates, one run selector, one valid time, explicit pressure-level variables and levels, and 2–50 samples (default 21).

## Geometry

Samples are evenly spaced by angular fraction along the shortest great-circle route between the endpoints. Exact start/end coordinates are preserved in the first and last samples. The result reports total great-circle distance plus each sample's fraction and along-track distance in kilometres.

Antimeridian crossings are handled naturally by great-circle interpolation. Exactly antipodal endpoints are rejected because the connecting great circle is not unique.

## Data access

The deterministic transect composes the existing batched-point primitive:

1. generate all great-circle coordinates locally;
2. resolve one GFS cycle for the complete pressure selection;
3. fetch the selected NOAA AWS Open Data GRIB messages once using `.idx` byte ranges;
4. reuse that immutable selected-message slice across every path coordinate;
5. sample and normalize each point locally through WFG's decoder abstraction.

A 21-sample path therefore does not perform 21 NOAA downloads. It has the same selected-message reuse and cache provenance as the shared multi-point implementation.

The npm default decoder is bundled. Native `wgrib2` can be selected as a compatibility/debug backend without changing transect semantics.

## Output

The response contains model/run/valid-time metadata, endpoints, total distance, requested variable/pressure-level lists, source provenance and ordered samples. Each sample includes:

- zero-based index;
- fractional position from 0 to 1;
- along-track distance;
- requested great-circle coordinate;
- actual GFS grid coordinate sampled by the local decoder;
- normalized values at every requested pressure surface.

Derived pressure variables such as wind, dew point, wet bulb, virtual temperature and equivalent potential temperature use the same shared dependency/derivation path as point and batch queries.

This primitive returns model data, deterministic geometry and physical transforms. It does not infer fronts, convergence lines, soaring quality, route safety or other forecast interpretation.
