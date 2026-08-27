# GEFS transects

A GEFS cross-section is the normal atmospheric query language with `dataset=gefs` and `geometry.type="transect"`.

GEFS transects support mixed pressure-level and non-isobaric selections, explicit member sets, ensemble quantiles and optional member audit values where allowed by guardrails.

## Geometry and efficiency

Great-circle interpolation is model-independent. The GEFS path executes as one multi-point mixed-selection query for the complete transect, fetching one immutable selected-message file per member and reusing it across path samples.

Upstream selected-file work therefore scales with members rather than members × samples.

## CLI

```bash
wfg query \
  --dataset gefs \
  --start 50.08,14.43 \
  --end 49.20,16.61 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,dew_point \
  --levels 850 \
  --fields temperature_2m,wind_10m \
  --members c00,p01,p02,p03 \
  --quantiles 0.1,0.5,0.9 \
  --samples 10 \
  --json
```

MCP: `query_atmosphere` with transect geometry.

## Ensemble semantics

Nonlinear derived quantities are evaluated member by member before aggregation. Wind direction uses circular aggregation. Accumulation and average intervals remain explicit.

Member spread and fractions remain raw ensemble evidence, not calibrated uncertainty or probability.
