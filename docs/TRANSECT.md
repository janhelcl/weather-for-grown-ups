# Pressure-level transects

WFG exposes a deterministic pressure-level cross-section primitive for agents that need atmospheric structure along a path rather than at one point or over a rectangular area.

## CLI

```bash
wfg transect \
  --start 50.08,14.43 \
  --end 47.27,11.40 \
  --valid 2026-08-24T12:00:00Z \
  --vars temperature,relative_humidity,wind \
  --levels 1000,925,850,700,500 \
  --samples 21 \
  --json
```

## MCP

MCP exposes the same primitive as `get_gfs_transect`.

The request contains:

- `start` and `end` coordinates;
- `run` using the standard `latest`, `latest_complete`, or explicit-cycle semantics;
- one `validTime`;
- explicit pressure-level `variables`;
- explicit published `pressureLevelsHpa`;
- `samples` from 2 to 50, default 21.

## Geometry

Samples are evenly spaced by angular fraction along the shortest great-circle route between the endpoints. Exact start/end coordinates are preserved in the first and last samples. The result reports total great-circle distance plus each sample's fraction and along-track distance in kilometres.

Antimeridian crossings are supported naturally by the great-circle interpolation. Exactly antipodal endpoints are rejected because the connecting great circle is not unique.

## Data access

The transect is implemented on top of the existing batched-point primitive:

1. WFG generates all requested great-circle coordinates locally.
2. `BatchPointsService` resolves one GFS model cycle for the complete pressure selection.
3. The selected GRIB messages are fetched once from NOAA AWS Open Data using byte ranges.
4. The same local selected-message slice is sampled at every generated coordinate.

A 21-sample transect therefore does not perform 21 NOAA downloads. It has the same S3 selected-message reuse and cache provenance as `get_gfs_points`.

## Output

The response contains model/run/valid-time metadata, endpoints, total distance, requested variable and pressure-level lists, source provenance, and ordered samples. Each sample includes:

- zero-based index;
- fractional position from 0 to 1;
- along-track distance;
- requested great-circle coordinate;
- actual GFS grid point used by `wgrib2`;
- normalized values at every requested pressure surface.

Derived pressure-level variables such as wind, dew point, wet bulb, virtual temperature, and equivalent potential temperature use the same shared dependency/derivation path as point and batch queries.

This primitive returns model data and deterministic geometry/physical transforms. It does not infer fronts, convergence lines, soaring quality, route safety, or other forecast interpretation.
