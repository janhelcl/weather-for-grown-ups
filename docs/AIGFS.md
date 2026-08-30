# NOAA AIGFS

AIGFS is WFG's first AI forecast dataset. It is deliberately exposed through the same public atmospheric query language as GFS, GEFS and IFS:

```text
dataset × geometry × time × selection
```

Use `dataset: "aigfs"`. There is no AIGFS-specific public command or MCP tool.

## Model semantics

| Property | WFG contract |
| --- | --- |
| Public dataset | `aigfs` |
| Internal dataset | `aigfs_0p25` |
| Provider | NOAA |
| Model class | `ai` |
| Result kind | deterministic |
| Horizontal grid | 0.25° |
| Initialization cycles | 00/06/12/18 UTC |
| Native forecast output | every 6 hours |
| Forecast horizon | f000 through f384 |
| Run selectors | `latest`, `latest_complete`, explicit ISO cycle |

The dataset registry carries `modelClass: "ai"` explicitly. AI is metadata and capability semantics, not a new query dimension.

## Operational inventory exposed by WFG

The operational pressure product currently publishes these pressure surfaces:

```text
50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000 hPa
```

Native pressure variables:

- temperature;
- U wind;
- V wind;
- geopotential height;
- specific humidity;
- vertical velocity.

WFG also exposes deterministic pressure-level derivations whose dependencies exist in that inventory, including wind, potential temperature, mixing ratio, virtual temperature, air density, wet-bulb temperature and equivalent potential temperature.

The operational surface product currently supports these canonical WFG fields:

- `temperature_2m`;
- `u_wind_10m`;
- `v_wind_10m`;
- `wind_10m` as the shared derived vector magnitude/direction;
- `mean_sea_level_pressure`;
- `total_precipitation`.

WFG does **not** synthesize missing native state. In particular, AIGFS does not expose pressure-level relative humidity in the operational product, so `relative_humidity` and dew-point derivation are not advertised.

## Supported operations

The unified capability registry currently advertises:

- point profile/state;
- native-cadence point time series;
- multi-point state;
- native-cadence multi-point time series;
- great-circle transects;
- bounded scalar area summaries/distributions;
- layer diagnostics;
- structural profile diagnostics;
- diagnostic time series for those layer/profile diagnostics.

Layer and profile diagnostics reuse the same shared deterministic meteorology kernels as the physics-based datasets. They are available only where their dependencies are present in AIGFS.

### Parcel diagnostics are intentionally absent

AIGFS is not advertised for parcel/LCL/LFC/EL/CAPE/CIN diagnostics. The operational surface product does not provide the full parcel initialization state used by WFG's shared parcel kernel: surface pressure, surface geopotential height and 2 m specific humidity are missing.

The capability boundary is explicit. WFG does not substitute another model's surface state or invent a parcel initialization.

### Area semantics

Area queries require one native scalar pressure variable at one pressure level, or one native scalar surface field. Pointwise derived vectors such as `wind` and `wind_10m` are not accepted as area scalars yet.

## Data access

AIGFS is read from NOAA NOMADS raw HTTPS products. NOMADS does not currently expose an AIGFS grib-filter endpoint.

WFG therefore follows NOAA's indexed partial-download pattern:

1. fetch and cache the immutable `.idx` inventory;
2. identify the GRIB messages required by the canonical selection;
3. issue one covering HTTP byte-range request per required product;
4. cache the resulting immutable subset locally;
5. decode locally with the same bundled GRIB2 path used elsewhere in WFG.

NOMADS requests use the shared source access policy, including the existing courtesy interval. The cache does not invent an AIGFS-specific retry or pacing rule.

Operational source roots:

- https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/
- https://nomads.ncep.noaa.gov/

NOAA's partial-download guidance is the basis for the `.idx` + HTTP Range approach:

- https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_partial_download.shtml

## Example

```json
{
  "dataset": "aigfs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-31T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind", "specific_humidity"],
    "pressureLevelsHpa": [850, 700, 500],
    "fields": ["temperature_2m", "mean_sea_level_pressure"]
  }
}
```

Changing `dataset` to another supported deterministic source asks the same atmospheric question. The answer still preserves the source model's own run, cadence, grid and provenance.

## Comparison scope

AIGFS is queryable now, but this first implementation deliberately does not bolt another pair-specific branch onto `compare_datasets`.

GFS↔AIGFS, AIGFS↔AIFS and broader physics↔AI comparisons belong behind the comparison-strategy registry described in the roadmap. Query compatibility does not by itself imply scientifically meaningful comparison semantics.
