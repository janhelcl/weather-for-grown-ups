# Atmospheric query memory safety

Normal point and time-series queries must be safe under the default Node heap. WFG protects that contract in three complementary places:

1. **GFS point access chooses the appropriate transport automatically.** NOAA AWS byte ranges are efficient for narrow selections, but each retained GRIB message still contains a full global grid. For wide point/profile selections, unified GFS routing counts the raw GRIB messages required per valid time (after expanding derived variables/fields) and uses NOMADS' geographic subset instead. Narrow selections stay on AWS S3. An explicit `source` remains an exact caller override.
2. **Bundled point decoding is message-streamed.** When a point request does use a source that retains full grids, bundled decoding parses, samples and releases one GRIB message at a time instead of materializing every requested variable/level grid together. Independent messages may unpack on a process-local worker pool (CPU overlap only; no extra provider access). Multi-point sampling unpacks each message once. This bounds peak heap even for an explicit wide S3 request.
3. **Retrieval fan-out is bounded before acquisition.** `query_atmosphere` computes the upper bound of `spatial samples × valid-time steps` for point-like geometries and enforces `limits.maxPointSteps` (default hard safety budget: 5,000). Excessive requests fail as non-retryable `INVALID_REQUEST` errors with structured `point_steps` details and repair guidance.

Automatic GFS point routing currently keeps selections of up to 16 raw GRIB messages per valid time on S3 and routes wider selections through the spatially subsetted NOMADS path. This threshold is an internal transport-performance policy, not a public query limit.

The point-step budget deliberately does not multiply by pressure-variable/level count: normal selection width is handled by transport selection plus message-streamed decoding. Area/grid operations retain their dedicated grid-point limits. Provider access/concurrency policies remain separate concerns.

Increasing `NODE_OPTIONS` is not part of the normal operating contract.
