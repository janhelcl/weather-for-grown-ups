# Atmospheric query memory safety

Normal point and time-series queries must be safe under the default Node heap. WFG protects that contract in two complementary places:

1. **Point decoding is message-streamed.** Provider byte-range subsetting removes unrequested GRIB messages, but retained messages may still contain a full model grid. Bundled point decoding therefore parses, samples and releases one GRIB message at a time instead of materializing every requested variable/level grid together.
2. **Retrieval fan-out is bounded before acquisition.** `query_atmosphere` computes the upper bound of `spatial samples × valid-time steps` for point-like geometries and enforces `limits.maxPointSteps` (default hard safety budget: 5,000). Excessive requests fail as non-retryable `INVALID_REQUEST` errors with structured `point_steps` details and repair guidance.

The point-step budget deliberately does not multiply by pressure-variable/level count: selection width is handled by message-streamed point decoding. Area/grid operations retain their dedicated grid-point limits. Provider access/concurrency policies remain separate concerns.

Increasing `NODE_OPTIONS` is not part of the normal operating contract.
