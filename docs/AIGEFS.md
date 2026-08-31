# NOAA AIGEFS

AIGEFS is WFG's NOAA AI ensemble dataset. It uses the same public atmospheric query language as every other forecast source:

```text
dataset × geometry × time × selection
```

Use `dataset: "aigefs"`. There is no AIGEFS-specific CLI command or MCP tool.

## Model semantics

| Property | WFG contract |
| --- | --- |
| Public dataset | `aigefs` |
| Internal dataset | `aigefs_0p25` |
| Provider | NOAA |
| Model class | `ai` |
| Result kind | ensemble |
| Members | 31 |
| Canonical member IDs | `c00,p01..p30` |
| Upstream member directories | `mem000..mem030` |
| Horizontal grid | 0.25° |
| Initialization cycles | 00/06/12/18 UTC |
| Native forecast output | every 6 hours |
| Forecast horizon | f000 through f384 |
| Run selectors | `latest`, `latest_complete`, explicit ISO cycle |

NOAA describes AIGEFS as a 31-member AI ensemble initialized from GEFS perturbations, with both initial-condition and model uncertainty represented. WFG preserves it as a real ensemble rather than reducing it to the upstream mean/spread products.

## Member-first meteorology

AIGEFS reuses the deterministic AIGFS state normalization and meteorology kernel **inside each selected member**:

```text
AIGEFS member
    ↓
minimal indexed GRIB selection
    ↓
AIGFS deterministic normalization / derivation
    ↓
member result
    ↓
repeat for selected members
    ↓
ensemble distribution
```

That ordering matters for nonlinear diagnostics. Layer and profile diagnostics are evaluated independently within each member before aggregation. WFG never derives them from an ensemble-mean profile.

Numeric ensemble outputs report arithmetic mean, population standard deviation, extrema and caller-selected quantiles. Wind direction uses circular aggregation. Member/event fractions are raw ensemble evidence, not calibrated probability.

## Inventory and capability boundary

AIGEFS member files expose the same operational pressure/surface state family currently used by WFG's AIGFS integration.

Pressure levels:

```text
50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000 hPa
```

Pressure variables include temperature, U/V wind, geopotential height, specific humidity and vertical velocity, plus deterministic per-member derivations whose dependencies exist.

Surface fields currently exposed by WFG:

- `temperature_2m`;
- `u_wind_10m`;
- `v_wind_10m`;
- `wind_10m`;
- `mean_sea_level_pressure`;
- `total_precipitation` at positive forecast leads.

The current AIGEFS capability set covers point, native-cadence time range, multi-point, multi-point range, transect, area, layer diagnostics, profile diagnostics and diagnostic time ranges.

Parcel diagnostics remain intentionally unsupported because the operational AI surface inventory does not provide the complete parcel-initialization state required by WFG's shared parcel kernel.

Run comparison and cross-dataset comparison are also not advertised yet. Those belong behind the comparison-strategy registry in the roadmap rather than another pair-specific branch.

## Data access

WFG reads AIGEFS from NOAA's EAGLE Open Data bucket on AWS. Operational ensemble members are stored independently under member directories, so WFG can select only the requested member/field messages with immutable `.idx` inventories and HTTP byte ranges.

The canonical WFG member IDs map directly:

```text
c00 -> mem000
p01 -> mem001
...
p30 -> mem030
```

AWS access uses WFG's NOAA-AWS source policy, independent from NOMADS courtesy pacing. Selected immutable slices are cached locally per member.

## Example

```json
{
  "dataset": "aigefs",
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
    "fields": ["temperature_2m", "wind_10m"]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

Changing only `dataset` preserves the atmospheric question while changing the forecast machinery and uncertainty representation.
