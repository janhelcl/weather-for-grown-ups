# Historical GFS analysis

WFG can query historical NOAA GFS model analyses from the NCEI Grid 4 archive. This is a separate product from the current operational GFS 0.25° forecast surface.

## What this is

The history surface exposes **GFS Grid 4 analysis fields on the 0.5° grid** for exact 00, 06, 12 and 18 UTC analysis cycles. NCEI's online Grid 4 analysis archive begins in 2007.

An analysis is the model's assimilated atmospheric state at the analysis time. It is useful for questions such as:

- What did the GFS analysis show over Prague at 850 hPa on a historical day?
- What did the vertical temperature, humidity and wind profile look like during a past event?
- Can I retrieve comparable model-state inputs for a known past date?

It is **not** a direct observation, and the long GFS record is **not a homogeneous climatological reanalysis**. Model versions, assimilation systems and available fields changed over time. WFG therefore labels the result `gfs_grid4_analysis_0p5` and returns an explicit caveat rather than presenting it as climatology.

## Supported variables

The first history surface intentionally uses a stable subset of the long archive:

- `temperature`
- `relative_humidity`
- `u_wind`
- `v_wind`
- `geopotential_height`
- `vertical_velocity`
- `absolute_vorticity`
- `wind` — derived from U/V
- `dew_point` — derived from temperature/RH
- `potential_temperature` — derived from temperature and pressure

A requested pressure level must actually exist for every requested variable in that historical file. Older GFS analyses do not expose every modern pressure level for every field; WFG reports missing fields explicitly instead of silently interpolating them.

Older Grid 4 files also use different pressure axes for some variables. WFG groups compatible variables into one NCSS request and fetches incompatible axes separately before merging them by pressure level. For example, temperature, humidity, wind and geopotential height can share the full pressure profile while vertical velocity and absolute vorticity may require their own archive requests.

## CLI

```bash
wfg history \
  --lat 50.08 \
  --lon 14.43 \
  --at 2017-05-09T12:00:00Z \
  --vars temperature,relative_humidity,wind,geopotential_height \
  --levels 1000,925,850,700,500 \
  --json
```

`--at` must be an exact GFS analysis cycle at 00, 06, 12 or 18 UTC.

## MCP

Tool: `get_gfs_historical_profile`

Example input:

```json
{
  "latitude": 50.08,
  "longitude": 14.43,
  "analysisTime": "2017-05-09T12:00:00Z",
  "variables": ["temperature", "relative_humidity", "wind", "geopotential_height"],
  "pressureLevelsHpa": [1000, 925, 850, 700, 500]
}
```

The result includes the requested point, sampled 0.5° grid point, normalized profile values, exact NCEI dataset path, cache status, and the analysis/climatology caveat.

## Data access and caching

WFG uses NCEI's THREDDS NetCDF Subset Service (NCSS) in grid-as-point mode. A history query requests pressure profiles at one point rather than downloading the full historical GRIB file. Compatible variables are bundled together; variables that use different historical pressure axes are fetched separately and merged locally.

Responses are cached locally because historical analyses are immutable. Cache misses use the same file-based NOAA request throttle as the existing NOMADS path; the default cooldown remains 11 seconds. Multi-axis requests therefore also preserve the required delay between successive NOAA calls.

The NCEI archive has two filename conventions. WFG handles the historical `gfsanl_4_...` layout before June 2020 and the later `gfs_4_...` layout from June 2020 onward.

## What comes next

This first increment deliberately provides **historical model state**, not climatological statistics. Natural follow-ons are:

1. bounded historical time-series sampling;
2. analog-day search over selected variables/levels;
3. anomaly and percentile calculations against a deliberately chosen homogeneous reanalysis/climatology source;
4. archived-forecast verification, kept separate from analysis history.
