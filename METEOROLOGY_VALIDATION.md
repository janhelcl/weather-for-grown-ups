# Meteorology reference validation

WFG has two distinct test layers:

1. **Implementation tests** check contracts, edge cases, orchestration, and exact behavior of WFG's own algorithms.
2. **Golden-reference tests** compare deterministic meteorological calculations with published values from an independent implementation.

The golden suite is `test/golden-meteorology.test.ts`. It intentionally stays TypeScript-only; MetPy is **not** installed in CI. Reference inputs and outputs are checked into the test so a future upstream MetPy release cannot silently move WFG's regression baseline.

## Primary reference

The initial external oracle is **MetPy 1.7**, using values published in the MetPy API documentation and its `tests/calc/test_thermo.py` regression suite.

Covered today:

| WFG calculation | External reference | Acceptance philosophy |
| --- | --- | --- |
| Dew point from T/RH | MetPy `dewpoint_from_relative_humidity` | Tight numerical agreement |
| Potential temperature | MetPy `potential_temperature` | Tight agreement, allowing small constant differences |
| Equivalent potential temperature | MetPy `equivalent_potential_temperature` | Tight agreement; both use the Bolton family of equations |
| LCL | MetPy `lcl` | Physical agreement within explicit tolerance; WFG uses Bolton while MetPy 1.7 uses Romps (2017) |
| Wet-bulb temperature | MetPy `wet_bulb_temperature` | Physical agreement within explicit tolerance; WFG uses an adiabatic-saturation enthalpy solve while MetPy uses Normand's rule |
| Virtual temperature | MetPy thermodynamics regression test | Tight agreement after converting MetPy mixing ratio to WFG specific humidity |
| Moist-air density | MetPy thermodynamics regression test | Tight agreement after the same humidity conversion |
| Surface-parcel CAPE/CIN | MetPy `test_cape_cin` sounding | Wider tolerance because parcel ascent, crossing insertion, and numerical integration differ |
| LFC/EL | MetPy LFC/EL regression soundings | Pressure agreement within explicit tolerance |

## Why tolerances are explicit

A meteorological validation suite should not confuse implementation identity with physical agreement. Several quantities have multiple accepted formulations or depend on numerical choices:

- MetPy 1.7 changed LCL to the Romps (2017) direct solution; WFG currently uses the Bolton (1980) construction because that is also used consistently in its theta-e/parcel machinery.
- WFG wet bulb solves an adiabatic-saturation enthalpy balance; MetPy uses a Normand construction with moist-adiabatic descent.
- CAPE/CIN depend on parcel ascent details, virtual-temperature treatment, inserted zero-buoyancy crossings, environmental interpolation, and integration resolution.

For that reason every golden assertion carries its own tolerance and source description. Tight algebraic transforms use tight tolerances; higher-order parcel diagnostics use larger tolerances that should only be changed deliberately and with an explanation.

## Reference cases currently pinned

The core published MetPy examples include:

- dew point: 10 °C at 50% RH → 0.047900916 °C
- potential temperature: 800 hPa, 273 K → 290.972015 K
- equivalent potential temperature: 850 hPa, 20 °C, 18 °C dew point → 353.898874 K
- LCL: 943 hPa, 33 °C, 28 °C dew point → 877.033549 hPa and 26.7591908 °C in MetPy 1.7
- wet bulb: 993 hPa, 32 °C, 15 °C dew point → 20.3937601 °C

The parcel-level regression uses MetPy's compact basic sounding:

- pressure: `[959, 779.2, 751.3, 724.3, 700, 269]` hPa
- temperature: `[22.2, 14.6, 12, 9.4, 7, -38]` °C
- dew point: `[19, -11.2, -10.8, -10.4, -10, -53.2]` °C
- CAPE: 223.927212 J/kg
- CIN: -21.4414153 J/kg
- EL: approximately 476.307 hPa

The lower-profile LFC reference is approximately 727.055 hPa.

## Rules for extending the suite

When adding a new deterministic meteorological calculation:

1. Prefer an independent, widely used implementation or published meteorological reference.
2. Store the exact input, expected output, reference identity, and tolerance in the repository.
3. Do not add the reference package as a production dependency.
4. Use a tolerance based on formulation/numerics rather than merely loosening the test until it passes.
5. Keep ordinary unit tests as well; golden tests complement them rather than replace them.
6. For sampled profile diagnostics, record the sampling resolution explicitly so a coarse pressure list is never mistaken for a continuous sounding.

Future high-value additions are freezing-level/inversion reference soundings, layer diagnostics against independent calculations, and separate golden cases for mixed-layer and most-unstable parcels.
