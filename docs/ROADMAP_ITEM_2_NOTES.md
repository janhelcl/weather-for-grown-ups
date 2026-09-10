# Agent ergonomics roadmap item 2 — implementation notes

This change addresses the two failure modes in **Eliminate unsafe memory behavior and bound ordinary queries**:

- bundled point decoding no longer retains expanded grids for every selected GRIB message simultaneously;
- unified point-like atmospheric queries are rejected before adapter/source access when their spatial × temporal fan-out exceeds the declared safety budget.

The guard uses existing public `limits.maxPointSteps` semantics and returns a structured non-retryable `INVALID_REQUEST` naming `point_steps` as the limiting dimension. Provider-specific acquisition limits remain below the public query boundary.

The representative regression to re-run in UAT is a GFS point time series combining several surface fields with several pressure variables/levels across multiple valid times under the normal Node heap, without `NODE_OPTIONS` overrides.
