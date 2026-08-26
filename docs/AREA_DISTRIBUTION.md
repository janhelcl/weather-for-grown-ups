# Rich deterministic GFS area statistics

The deterministic `wfg area --model gfs` / MCP `summarize_gfs_area` surface can add percentiles, threshold fractions and extrema metadata to the bounded min/max/mean summary. These options never return the raw GFS grid.

GEFS area statistics use different member-first semantics and are documented in [GEFS_ENSEMBLE.md](GEFS_ENSEMBLE.md).

## Optional outputs

A caller may request:

- percentiles from 0 to 100;
- fractions of defined grid cells greater than or equal to (`gte`) or less than or equal to (`lte`) one or more thresholds;
- representative min/max grid coordinates plus the number of cells tied at each extremum.

All calculations use **defined GFS grid cells only** and are unweighted by cell area, matching the basic area mean.

Thresholds and percentile/extrema values use WFG's normalized public output unit. A temperature threshold of `15`, for example, means 15 °C rather than 15 K.

Percentiles use linear interpolation over sorted defined grid values with zero-based position `(p / 100) * (n - 1)`. The response labels that method as `linear_interpolation_sorted_defined_grid_points`.

For extrema with ties, WFG returns the first deterministic grid point in local decoder order together with `tiedGridPoints`; it does not imply the extremum is spatially unique.

## CLI

```bash
wfg area \
  --model gfs \
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

`--gte` and `--lte` are repeatable. The same options work for supported raw non-isobaric fields such as `low_cloud_cover_average`, whose vertical and temporal semantics remain explicit.

## MCP

`summarize_gfs_area` accepts the corresponding structured fields, for example:

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

The NOMADS request is geographically cropped first and the `maxGridPoints` guard is checked before any network access.

For a basic area summary WFG only needs local summary statistics. When rich statistics are requested, it materializes the already bounded grid values **inside the local calculation**, computes the requested distribution outputs, then discards the grid.

For non-isobaric fields, exact variable/vertical/temporal message selection is performed before statistics are calculated.

Both paths use WFG's decoder abstraction. The npm default is the bundled GRIB2 decoder; native `wgrib2` is an optional backend. The public result and statistical definitions do not depend on which decoder is selected.

The NOMADS cache and shared 11-second courtesy limiter apply in either case.
