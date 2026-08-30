# IFS vs IFS ENS comparison

WFG exposes ECMWF deterministic IFS as `dataset: "ifs"` and the 50 perturbed ENS members as `dataset: "ifs-ens"`.

Under ECMWF Cycle 50r1, the unperturbed control is the deterministic `oper/fc` forecast. WFG therefore does **not** add a synthetic `c00` or 51st member to IFS ENS. Instead, `compare_datasets` can place the deterministic control value relative to the aligned perturbation distribution.

## Query

The comparison uses one shared initialization cycle, one valid time, one point, one scalar pressure-level variable and one pressure level:

```json
{
  "datasets": ["ifs", "ifs-ens"],
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-30T12:00:00Z"
  },
  "variable": "temperature",
  "pressureLevelHpa": 850,
  "run": "latest",
  "ifsEnsMembers": ["p01", "p02", "p03", "p04", "p05"],
  "quantiles": [0.1, 0.5, 0.9]
}
```

For `run: "latest"`, WFG walks ECMWF cycles until deterministic IFS and every requested perturbation can satisfy the same valid time and pressure selection. This matters because 00/12Z and 06/18Z cycles have different deterministic and ensemble horizons.

The CLI uses the same pair explicitly:

```bash
wfg compare-datasets \
  --dataset ifs \
  --against ifs-ens \
  --lat 50.08 \
  --lon 14.43 \
  --at 2026-08-30T12:00:00Z \
  --var temperature \
  --level 850 \
  --ifs-ens-members p01,p02,p03,p04,p05 \
  --quantiles 0.1,0.5,0.9 \
  --json
```

Omitting `--dataset` preserves the earlier CLI defaults for the existing GFS↔GEFS, GFS↔IFS and GEFS↔IFS ENS branches.

## Result semantics

The result keeps the deterministic control and perturbation distribution distinct. It reports:

- the deterministic IFS scalar value;
- the selected IFS ENS member values and requested distribution summary;
- deterministic-minus-ensemble mean;
- the standardized control offset, `(control - perturbation mean) / perturbation population standard deviation`;
- counts and fractions of perturbations below / at-or-below the deterministic value;
- whether the deterministic value is below, within, or above the perturbation range.

A zero-spread perturbation selection returns `standardizedDifference: null`.

The comparison currently accepts scalar canonical pressure-level quantities shared by deterministic IFS and IFS ENS. Multi-output `wind` is intentionally excluded because wind direction is circular and cannot be reduced to the same single scalar comparison contract without losing semantics.

## Interpretation

This operation answers a model-structure question:

> Where does the deterministic ECMWF control sit relative to its perturbed ensemble?

It is **not** forecast verification. It does not imply that the ensemble spread is calibrated uncertainty, and the fraction of perturbations below the control is not a calibrated probability. The operation also does not pair perturbation labels with anything outside their own IFS ENS distribution.
