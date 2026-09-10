# Investigation patterns

These are reasoning patterns, not scripts. Adapt them to the available datasets, fields, geometry, time window, and user question. Discover capabilities first and stop when the evidence is sufficient.

## Model disagreement

Use when the user asks why two forecast systems disagree.

1. Use `align` with one source per model at the valid time and inspect the deterministic fields that directly express the disagreement.
2. Check whether the disagreement persists in the vertical structure when relevant.
3. Inspect the corresponding ensemble distributions when available.
4. Ask whether deterministic model differences are larger or smaller than within-system ensemble spread.
5. Use regional guidance only when finer spatial structure is relevant and the location is inside domain.
6. Report sampling/resolution differences from the per-source `gridPoint` / `nativeGrid` provenance and never subtract cells WFG marks `comparable: false` or `circular_degrees` without circular arithmetic.

## Forecast confidence / timing uncertainty

Use when the question is about confidence, timing spread, or whether a change is robust.

1. Start with an appropriate ensemble family.
2. Inspect the evolution of the physically relevant field or diagnostic through time.
3. Preserve member/distribution evidence rather than reducing it to a single deterministic forecast.
4. Align the latest and previous runs (`--source gefs --source gefs@<older cycle>`) when forecast convergence or instability matters.
5. Distinguish raw ensemble fractions/spread from calibrated probability.

## Explain a surface forecast from atmospheric structure

Use when the surface outcome is clear but the mechanism is not.

1. Query the surface fields that motivate the question.
2. Inspect pressure profiles or supported diagnostics across the relevant period.
3. Add spatial geometry only if the mechanism may be advective, frontal, or terrain-sensitive.
4. Use deterministic models for the structure and ensembles if uncertainty in that structure matters.
5. Explain the mechanism while keeping model evidence separate from interpretation.

## Global versus regional guidance

Use when a convection-permitting/regional model diverges from global guidance.

1. Confirm the regional domain and supported variables.
2. Establish the larger-scale state from a global model.
3. Inspect the regional model at the same valid time without pretending the grids are identical.
4. Put the global and regional sources in one `align` call; keep `initialization: shared` when the question is about model physics rather than run age.
5. If ensembles exist on both scales, compare independent distributions; do not pair members across systems.
6. Treat resolved mesoscale structure, grid sampling, and model physics as possible sources of disagreement.

## What did the model predict, and what did it get wrong?

Use for retrospective questions.

1. Retrieve the archived forecast initialized before the event.
2. Preserve initialization and lead time.
3. Compare against an available later analysis or observation/reference through WFG verification semantics.
4. Separate forecast error from hindsight interpretation.
5. Use analog search only if historical atmospheric similarity adds value.
6. State historical/reference coverage limitations explicitly.

## Front or regime transition

Use when the user asks when a front, trough, inversion break, wind shift, or similar transition arrives.

1. Identify a compact set of fields that express the transition.
2. Query a time range at native useful cadence.
3. Add profiles before/after the likely transition to inspect vertical structure.
4. Use multi-point/transect geometry if timing varies spatially.
5. Add ensembles to quantify timing spread.
6. Compare recent runs if convergence of timing matters.

## Spatial anomaly or suspicious grid-point signal

Use when one point looks extreme or inconsistent.

1. Do not interpret the single point immediately.
2. Expand to nearby multi-point or bounded-area evidence.
3. Use a transect when directional structure matters.
4. Compare another suitable model if available.
5. Preserve each dataset's native-grid sampling in the interpretation.

## Efficiency rule

Do not execute every step mechanically. A good WFG investigation is progressive: form a physical hypothesis, retrieve the minimum evidence needed to test it, and deepen only when the current evidence leaves a material question unresolved.
