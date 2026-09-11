# Agent discovery refactor validation

Validated on 2026-09-11 with Node v22.23.1 against baseline `d243013` (main). These are local observations, not latency guarantees; upstream download/decode cost remains workload-dependent.

## Reproducible offline measurements

Run `npm run bench:discovery` from the repository. Startup numbers are medians of seven separate compiled Node processes on the same machine. The catalog loop interleaves four representative queries after warming each inventory.

| Workload | Before | After |
| --- | ---: | ---: |
| CLI help | 223 ms | 90 ms |
| CLI catalog, wind, three matches | 236 ms | 100 ms |
| CLI capabilities, GFS | 223 ms | 92 ms |
| MCP server registration | 251 ms | 111 ms |
| 1,000 in-process catalog searches | 1,110 ms | 144 ms |

A 43-case comparison against the baseline confirmed unchanged catalog matches, scores, support ordering, capabilities and filtering before adding pagination. Pagination adds optional `offset` / `nextOffset`; it does not change ranking or the default page size.

## Offline verification

- 1,877 tests across 261 files passed, including CLI, MCP stdio/HTTP, native dataset services, schemas, geometry/time budgets and meteorology.
- Coverage passed the existing gates: 90.60% lines/statements, 93.25% functions, 85.05% branches.
- Typechecking, build, compiled CLI smoke, release metadata consistency and npm package dry-run passed.
- New regression tests cover concurrent lazy initialization, failure retry, injected adapters, AI/regional service wiring, no weather-service loading during discovery, catalog cache mutation isolation, deterministic pagination and protocol-advertised tool metadata.

## Live CLI matrix

Run `npm run test:live:agent`. All 21 checks passed with GFS initialization `2026-09-11T12:00:00Z` and valid times `2026-09-12T00:00:00Z` through `02:00:00Z`. IFS resolved its own initialization, which remains explicit in the result.

| Workload | Shapes and assertions |
| --- | --- |
| Discovery → capabilities → availability | Canonical temperature field, supported point selection, complete live-probed requested time |
| Point field, repeated | Finite temperature, identical repeated value, warm cache hit, S3 provenance |
| Pressure profile | Temperature/wind at 850/700/500 hPa, finite values |
| Mixed multi-point | Two points, two pressure levels plus surface field; shared point matches the individual query |
| Time series | Three hourly field samples; first time matches individual query |
| Multi-point time series | Two points × three hours, finite pressure temperatures |
| Transects | Five and 25 samples; shared endpoint matches the individual profile |
| Larger point batch | 25 points with finite pressure temperatures |
| Area | 0.5° × 0.5° box, native cell statistics, three percentiles, extrema, NOMADS provenance |
| Wide profile | Five variables × five pressure levels, finite values, automatic geographic-subset routing |
| Layer diagnosis and bundled state/diagnosis | Finite wind shear; bundled and standalone diagnostics agree |
| GEFS ensemble wind | Two selected members, two-member distribution and vector summaries |
| IFS field and GFS/IFS alignment | Finite IFS temperature; both alignment sources succeed |
| Size/domain rejections | Expected non-retryable `INVALID_REQUEST` and `OUT_OF_DOMAIN` envelopes |

Live coverage is intentionally bounded. Larger ensemble populations, retrospective/historical access and other providers are covered by deterministic suites and their existing dedicated live scripts; the full provider live suite was not run for this refactor.
