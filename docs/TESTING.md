# Testing

WFG's default verification is deterministic and offline. Tests do not contact upstream weather providers unless they are one of the explicit live scripts.

## Normal verification

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:smoke
npm run pack:check
```

Normal CI runs the supported Node matrix, enforces coverage gates, builds the package, exercises CLI/package entrypoints, and verifies the production Docker/MCP paths without depending on NOAA availability.

## Coverage gates

CI fails below:

- Lines: 90%
- Statements: 90%
- Functions: 90%
- Branches: 85%

Thin command-registration/presentation adapters are excluded from percentage accounting where appropriate; their wiring has separate registry/smoke coverage. Core services, schemas, parsing helpers, handlers and meteorological calculations remain inside the coverage policy.

## What the offline suite covers

The deterministic suite covers the important boundaries across global, AI/hybrid and regional model families, including:

- query schemas, run selectors, valid-time/cadence rules, pressure levels and response-size guardrails;
- GFS, AIGFS, AIGEFS, HGEFS, GEFS, IFS/IFS ENS, AIFS/AIFS ENS, ICON-D2/ICON-D2-EPS and AROME/PE-AROME catalogs, raw/derived variables, dependencies and vertical/temporal semantics;
- dataset spatial-domain/native-grid declarations, catalog coverage filtering and explicit `OUT_OF_DOMAIN` failures before source access;
- latest/query-aware run resolution and fixed-cycle range semantics;
- NOAA AWS `.idx` parsing, exact message selection, byte-range planning, caching and in-flight deduplication;
- NOMADS query planning, bounded geographic subsets and the shared courtesy limiter;
- bundled/native decoder abstraction, normalized point/area decoding and failure paths;
- deterministic and member-first pressure-profile thermodynamics, including AIGEFS reuse of the AIGFS deterministic kernel per member, HGEFS composition across GEFS/AIGEFS members with native-grid provenance, and AIFS ENS reuse of the AIFS deterministic atmospheric kernel per member;
- layer, whole-profile and parcel diagnostics;
- GEFS member-first parcel/LCL/LFC/EL/CAPE/CIN distributions;
- layer/profile/parcel diagnostic time-series composition;
- raw and mixed-field point/time/multi-point operations;
- great-circle GFS and ensemble-native GEFS transects;
- deterministic and member-first area statistics;
- deterministic run deltas and GEFS distribution shifts;
- aligned global/model-class comparisons plus restrictive global↔regional point strategies with explicit shared-cycle, field-intersection and no-regridding semantics;
- CLI/MCP handler mappings and Streamable HTTP MCP negotiation with external network access blocked.

The test suite also checks the scientific semantics that are easy to accidentally flatten: accumulation/average intervals, circular wind direction, stable sampled grids, member-first nonlinear calculations and raw-member-fraction interpretation.

## Smoke tests

`npm run test:smoke` runs the compiled CLI/package surface without contacting NOAA. It is intended to catch broken command registration, packaging, imports and executable wiring.

It is not the authoritative inventory of every public command. Unit/registry tests cover command registration more broadly, including model-native aliases such as the GEFS parcel commands.

## Package verification

`npm run pack:check` builds and dry-runs the npm tarball. The package ships:

- `dist/`
- root `README.md`
- `docs/`
- `LICENSE`

This matters after the documentation cleanup: detailed Markdown lives under `docs/` rather than being accidentally dropped from the published package.

## Network isolation

Normal tests install a network guard so accidental external requests fail immediately. The Streamable HTTP MCP test permits loopback communication only; it cannot contact NOAA.

This separation is deliberate:

- deterministic CI answers whether WFG itself behaves correctly;
- live integration answers whether today's upstream products and access assumptions still match those contracts.

## Live provider integration

```bash
npm run test:live:all
```

The live suite covers the bundled decoder against real GFS/GEFS data, deterministic GFS AWS composition, bounded AIGFS, AIGEFS, HGEFS, AIFS and AIFS ENS source checks, regional ICON-D2, ICON-D2-EPS and AROME transport/decode paths, GEFS ensemble/spatial/temporal surfaces, GEFS run comparison, bounded area behavior, fixed Grid 4 analysis/forecast verification and skill aggregation, and a recent archived GFS 0.25° forecast verified against the Praha-Libuš IGRA radiosonde. PE-AROME has a separate credential-gated live smoke because its targeted WCS API requires a subscribed Météo-France endpoint/token and is therefore intentionally absent from the anonymous aggregate live suite. GFS parity is deliberately split into two different contracts: `test:live:gfs-operational-parity` compares current NOMADS and NOAA AWS transports, while `test:live:gfs-archive-equivalence` compares the current operational state with the matching historical archive only when the exact same run exists on both sides (AWS where the operation exposes a source selector; the bounded operational area path remains NOMADS-backed).

It runs weekly on Monday at 05:17 UTC plus manual dispatch, never as a normal PR/main gate.

`npm run test:live:igra` exercises the real IGRA station list, current station ZIP format, exact sounding parser, station provenance, and GDEX archived forecast comparison. `npm run test:live:igra-skill` then exercises the bounded range form over two recent 12Z soundings and +24/+48 h leads, requiring successful aggregated skill statistics while allowing individual case failures to remain explicit. Archive equivalence never falls back to operational transport parity. When no same-run overlap exists inside the AWS retention window it reports `archiveStatus: "not_tested_no_overlap"`; that is an explicit “not tested”, not evidence of archive equivalence. See [LIVE_SMOKE.md](LIVE_SMOKE.md) for exact current scripts, pacing and failure triage.

## Meteorology reference validation

Implementation tests are complemented by independent golden meteorology cases for the physical kernels. See [METEOROLOGY_VALIDATION.md](METEOROLOGY_VALIDATION.md) for reference sources, formulas and tolerances.
