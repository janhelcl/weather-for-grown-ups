# Historical GFS mixed fields

WFG exposes a deliberately bounded subset of NOAA NCEI GFS Grid 4 analysis fields using the **same field IDs and result vocabulary as operational GFS** where the historical quantity is physically comparable.

The source is GFS model analysis on the historical 0.5° Grid 4 archive. It is not a direct observation and the long GFS archive is not a homogeneous climatological reanalysis. Field availability can change across model eras; WFG fails explicitly when a requested archived field is absent rather than silently substituting another product.

## Supported fields

Current historical non-isobaric IDs are:

- surface: `surface_pressure`, `surface_geopotential_height`, `surface_temperature`, `surface_cape`, `surface_cin`
- 2 m: `temperature_2m`, `relative_humidity_2m`, `specific_humidity_2m`, `dew_point_2m`
- 10 m wind: `u_wind_10m`, `v_wind_10m`, `wind_10m`
- 80 m: `temperature_80m`, `specific_humidity_80m`, `pressure_80m`, `u_wind_80m`, `v_wind_80m`, `wind_80m`
- 100 m: `temperature_100m`, `u_wind_100m`, `v_wind_100m`, `wind_100m`
- column: `precipitable_water`, `total_column_cloud_water`, `column_relative_humidity`, `total_column_ozone`

Derived wind uses the same U/V wind kernel as operational GFS. Returned fields use the standard WFG structure:

```json
{
  "id": "wind_10m",
  "level": { "type": "height_above_ground_m", "heightM": 10 },
  "temporal": { "type": "instantaneous" },
  "values": {
    "windSpeedMs": 5.0,
    "windDirectionDeg": 216.87
  }
}
```

Historical analysis fields are currently **instantaneous**. Forecast-window products are not silently reinterpreted as analysis state. In particular, `total_precipitation` is deliberately not exposed by this analysis primitive because its accumulation semantics are different from an f000 analysis state.

The modern operational GFS 20/30/40/50 m wind ladder is also not advertised for history merely for API symmetry. The archived Grid 4 product has different height availability, including 10/80/100 m in the supported era.

## Single historical mixed-field query

CLI:

```bash
wfg history-fields \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --fields temperature_2m,wind_10m,precipitable_water,surface_cape \
  --vars temperature,relative_humidity,wind \
  --levels 850,700,500 \
  --json
```

MCP tool: `get_gfs_historical_fields`.

Pressure variables are optional. If supplied, `variables` and `pressureLevelsHpa` must be supplied together. This allows one operation to return, for example, an 850/700/500 hPa profile together with 2 m temperature, 10 m wind and PWAT.

NCEI variables that use compatible vertical axes are grouped into the same NCSS request. Incompatible axes are fetched separately and merged locally. All archive reads remain serial under WFG's file-backed NOAA courtesy limiter.

## Historical mixed-field time series

CLI:

```bash
wfg history-fields-timeseries \
  --lat 50.08 \
  --lon 14.43 \
  --from 2017-05-09T00:00:00Z \
  --to 2017-05-15T23:59:59Z \
  --cycles 12 \
  --fields temperature_2m,wind_10m,precipitable_water \
  --vars temperature,wind \
  --levels 850,700 \
  --max-steps 7 \
  --json
```

MCP tool: `get_gfs_historical_fields_timeseries`.

The time series uses the same bounds as historical pressure-profile time series: default `maxSteps=8`, hard maximum `16`. Only native 00/06/12/18 UTC analysis cycles are sampled, selected cycles are fetched serially, and each result step retains its exact NCEI dataset path and cache-hit flag.

This surface is intended for questions such as:

- How did 2 m temperature, 10 m wind and the 850 hPa profile evolve across a past event?
- How did PWAT and surface CAPE differ across comparable 12 UTC historical days?
- What was the near-surface wind environment during a historical pressure-profile setup?

For large multi-year corpus construction, use the history index/backfill primitives instead of turning the bounded time-series operation into an archive scan.
