# Rich deterministic GFS area statistics

Area statistics are part of the normal atmospheric query operation. Use area geometry with `dataset=gfs`; no separate public area tool exists.

The deterministic GFS implementation can add percentiles, threshold fractions and extrema metadata to the bounded min/max/mean summary without returning the raw grid. GEFS uses the same public query shape but preserves member-first spatial semantics.

## Optional outputs

A caller may request:

- percentiles from 0 to 100;
- fractions of defined grid cells greater than or equal to (`gte`) or less than or equal to (`lte`) thresholds;
- representative min/max grid coordinates plus the number of cells tied at each extremum.

All calculations use **defined GFS grid cells only** and are unweighted by cell area, matching the basic area mean. Threshold and percentile values use WFG's normalized public units.

Percentiles use linear interpolation over sorted defined grid values with zero-based position `(p / 100) * (n - 1)`. For extrema with ties, WFG returns the first deterministic grid point in local decoder order together with the tie count.

## CLI

```bash
wfg query \
  --dataset gfs \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature \
  --levels 850 \
  --percentiles 10,50,90 \
  --gte 15 \
  --lte 0 \
  --extrema \
  --json
```

The same operation can select one supported raw non-isobaric field instead of one pressure variable/level.

## MCP

Use `query_atmosphere` with `geometry.type="area"` and an `aggregate` object:

```json
{
  "dataset": "gfs",
  "geometry": {
    "type": "area",
    "westLongitude": 12,
    "eastLongitude": 18,
    "southLatitude": 48,
    "northLatitude": 51
  },
  "time": { "at": "2026-08-24T12:00:00Z" },
  "selection": {
    "variables": ["temperature"],
    "pressureLevelsHpa": [850]
  },
  "aggregate": {
    "percentiles": [10, 50, 90],
    "thresholds": [
      { "operator": "gte", "value": 15 },
      { "operator": "lte", "value": 0 }
    ],
    "includeExtremaLocations": true
  }
}
```

## Execution path

The NOMADS request is geographically cropped first and the grid guard is checked before network access. Rich statistics materialize only the already-bounded local values, compute the requested distribution outputs, then discard the grid.

For non-isobaric fields, exact variable/vertical/temporal message selection is performed before statistics are calculated. Decoder choice does not change the public contract.
