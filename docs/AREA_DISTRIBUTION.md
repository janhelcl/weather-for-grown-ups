# Rich bounded-area statistics

The default `wfg area` / MCP `summarize_gfs_area` response remains the existing bounded min, max, and unweighted grid-point mean. Rich distribution statistics are opt-in and never return the raw GFS grid.

## Optional outputs

A caller may request:

- percentiles in the range 0-100;
- fractions of defined grid cells greater than or equal to (`gte`) or less than or equal to (`lte`) one or more thresholds;
- representative min/max grid coordinates plus the number of cells tied at each extremum.

All calculations use **defined GFS grid cells only** and are unweighted by cell area, matching the existing area mean semantics.

Thresholds and returned percentile/extrema values use WFG's **normalized public output unit**. For example, a `temperature` / `temperature_2m` threshold of `15` means 15 °C, not 15 K.

Percentiles use linear interpolation over the sorted defined grid values with zero-based position `(p / 100) * (n - 1)`. The response names this method explicitly as `linear_interpolation_sorted_defined_grid_points`.

For extrema with ties, WFG returns the first deterministic grid point in wgrib2's output order together with `tiedGridPoints`; it does not imply that the extremum is spatially unique.

## CLI

```bash
wfg area \
  --west 12 --east 18 \
  --south 48 --north 51 \
  --valid 2026-08-24T12:00:00Z \
  --var temperature \
  --level 850 \
  --percentiles 10,50,90 \
  --gte 15 \
  --lte 0 \
  --extrema-locations \
  --json
```

`--gte` and `--lte` are repeatable.

The same options work for raw non-isobaric fields such as `low_cloud_cover_average`. Non-isobaric vertical and temporal semantics remain exact.

## MCP

`summarize_gfs_area` accepts optional structured fields:

```json
{
  "percentiles": [10, 50, 90],
  "thresholds": [
    { "operator": "gte", "value": 15 },
    { "operator": "lte", "value": 0 }
  ],
  "includeExtremaLocations": true
}
```

Up to 20 percentiles and 20 thresholds may be requested in one call. Duplicate percentiles are rejected.

## Execution path

Ordinary area calls continue to use the fast local `wgrib2 -stats` path.

Only when rich statistics are requested does WFG materialize the already geographically bounded field with `wgrib2 -spread -`. The NOMADS request is still cropped first and the existing `maxGridPoints` guard still applies before any network access. For non-isobaric fields, WFG first requires one exact GRIB record matching variable, vertical semantics, and instantaneous/accumulation/average semantics.

The bounded grid values exist only inside the local calculation. WFG returns aggregates and optional extrema coordinates, not the grid itself.

The NOMADS cache and shared 11-second courtesy limiter are unchanged.
