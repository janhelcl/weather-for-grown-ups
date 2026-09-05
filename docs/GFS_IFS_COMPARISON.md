# Deterministic GFS vs ECMWF IFS comparison

WFG can compare deterministic GFS and deterministic ECMWF IFS through the existing `compare-datasets` / `compare_datasets` operation.

The comparison keeps the models on one **shared initialization cycle**, one valid time, one point, one canonical pressure-level variable and one pressure level. It does not pretend their horizontal grids are identical: each sampled grid point is retained separately in the result.

## Contract

Select:

```json
{
  "datasets": ["gfs", "ifs"],
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-28T12:00:00Z"
  },
  "variable": "temperature",
  "pressureLevelHpa": 850,
  "run": "latest"
}
```

`latest` walks backward through common six-hour initialization cycles until both GFS and IFS can publish the requested valid time and pressure selection. An explicit run must be a shared 00/06/12/18 UTC cycle and must satisfy both models' native forecast cadence.

The optional `gfsGrid` keeps the deterministic GFS grid explicit as `0p25` or `0p50`. IFS remains its native Open Data 0.25° product.

## Canonical variables

The GFS/IFS branch accepts pressure variables published by both models, including raw variables and shared derived quantities such as wind, dew point, potential temperature, mixing ratio, virtual temperature, air density, wet-bulb temperature and equivalent potential temperature.

Derived quantities are computed independently from each model's normalized profile before comparison. WFG never probes for a fictitious derived GRIB field.

## Returned deltas

Every canonical output contains:

- the normalized GFS value;
- the normalized IFS value;
- `ifsMinusGfs`;
- the output unit;
- a delta kind.

Most outputs use a normal linear difference. Meteorological wind direction uses the shortest signed circular difference, so for example IFS 10° versus GFS 350° is +20°, not -340°.

The result explicitly labels these as:

`raw_deterministic_model_difference_not_error_or_uncertainty`

A model-to-model difference is not an observation error, verification score, calibrated uncertainty or statement that either model is correct.

## CLI

```bash
wfg compare-datasets \
  --dataset gfs \
  --against ifs \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-28T12:00:00Z \
  --var wind \
  --level 850 \
  --json
```

Omitting `--against` preserves the existing GFS/GEFS comparison behavior.
