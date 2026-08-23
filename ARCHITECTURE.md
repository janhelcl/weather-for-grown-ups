# Architecture

Weather for Grown Ups is primarily a **data-access product**, not a forecasting or interpretation layer.

```text
NOAA GFS
   ↓
source adapters
   ↓
normalization / query planning
   ↓
small deterministic derivations
   ↓
shared result contracts
   ↓
CLI / MCP
   ↓
agent interpretation
```

## Core owns

- canonical variable names
- run / valid-time / forecast-hour semantics
- pressure levels and later other vertical coordinates
- query planning
- upstream pacing and caching
- GRIB decoder abstraction
- normalized typed results
- deterministic transforms such as U/V → wind speed/direction, per-level thermodynamics, cross-level gradients/shear, and sampled whole-profile structure diagnostics with explicit vertical semantics

Derived variables declare their raw GFS dependencies in the shared catalog. Query planning expands those dependencies before source access, while the derivation itself happens only after raw completeness validation. This keeps NOAA access minimal and makes the same derived result available automatically to profile, batch-point, and time-series consumers.

Cross-level diagnostics are separate from per-level variables. A pressure-layer diagnostic explicitly names a lower-altitude/higher-pressure surface and an upper-altitude/lower-pressure surface, obtains one minimal two-level profile, and returns both the raw endpoints and deterministic diagnostic values. Gradients are normalized by the GFS geopotential-height difference rather than pretending pressure difference is geometric depth.

Whole-profile diagnostics are also explicit about sampling. The caller supplies the published pressure levels to inspect; WFG fetches the union of raw dependencies once, returns those sampled levels, and derives profile structure locally. Freezing-level crossings are interpolated between sampled temperatures/heights with log-pressure interpolation. Temperature inversions are reported only where adjacent sampled levels warm with height, with contiguous inversion segments merged. WFG does not imply structure between pressure levels that the caller did not request.

## Surface contracts

CLI and MCP are equal public surfaces over the same core. They must not maintain separate atmospheric result models.

Shared Zod result schemas define the public profile, pressure-layer, whole-profile-diagnostic, time-series, area-summary, latest-run, vertical-level, temporal-interval, and provenance contracts. Both surfaces validate core results against those schemas before emitting them. MCP also advertises the same schemas as tool output schemas.

A new core result shape is therefore incomplete until the shared contract accepts it and both CLI and MCP tests cover the relevant semantics.

## Core does not own

- activity-specific weather scores
- subjective forecast interpretation
- domain-specific safety judgments

Those belong to the consuming agent or a specialized application.

## GRIB strategy

Do not build a GRIB2 parser in TypeScript. `Wgrib2Decoder` is a narrow adapter around NOAA's `wgrib2` executable. The rest of the codebase deals only with typed values.

## Rate limiting

Every physical NOMADS request goes through `FileRateLimiter`. An atomically-created lock directory coordinates independent CLI and MCP processes on one machine. The completion timestamp is persisted separately, making the 11-second cooldown apply across process lifetimes. A hosted multi-replica deployment can replace this with Redis/Postgres behind the same boundary.
