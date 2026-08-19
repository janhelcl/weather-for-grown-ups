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
- deterministic transforms such as U/V → wind speed/direction

## Core does not own

- activity-specific weather scores
- subjective forecast interpretation
- domain-specific safety judgments

Those belong to the consuming agent or a specialized application.

## GRIB strategy

Do not build a GRIB2 parser in TypeScript. `Wgrib2Decoder` is a narrow adapter around NOAA's `wgrib2` executable. The rest of the codebase deals only with typed values.

## Rate limiting

Every physical NOMADS request goes through `FileRateLimiter`. An atomically-created lock directory coordinates independent CLI and MCP processes on one machine. The completion timestamp is persisted separately, making the 11-second cooldown apply across process lifetimes. A hosted multi-replica deployment can replace this with Redis/Postgres behind the same boundary.
