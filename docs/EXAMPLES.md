# Investigation gallery

Start with a weather question. WFG gives the agent enough model evidence to build the investigation from scratch.

Each example below is an **agent prompt** followed by a useful evidence path. Exact fields, levels, geometries and supported comparisons should be discovered from the catalog before execution.

## Forecast diagnosis

### Give me the serious forecast

> What does the atmosphere over Prague look like tomorrow afternoon? Cover the surface and vertical structure, compare the main global guidance, and show which parts are robust across the ensembles.

`GFS + IFS → pressure profiles → GEFS + IFS ENS → regional model if useful`

A good default when the user wants more than a consumer forecast but has not already identified a specific feature to investigate.

### Is a front coming?

> Is a frontal passage expected near Prague tomorrow? If so, when does it arrive, what changes through the column, and how consistent are the models?

`GFS + IFS → time evolution → pressure profiles → GEFS + IFS ENS → align latest vs previous runs`

Establish whether the transition exists before reasoning about its timing or structure.

## Model comparison

### How different are AI and physics guidance?

> How do AIFS and IFS describe the atmosphere over Prague tomorrow? Where do they disagree through time and height, and is that disagreement large relative to their ensemble uncertainty?

`align IFS, AIFS → pressure profiles → align IFS ENS, AIFS ENS`

Compare forecast-system disagreement with within-system spread rather than treating either deterministic run as truth.

### What does the regional model add?

> Compare IFS and ICON-D2 near Munich tomorrow afternoon. Does ICON-D2 add mesoscale structure that is absent from IFS, and which differences remain meaningful once sampling and native resolution are kept explicit?

`IFS ↔ ICON-D2 → nearby points → spatial context → native-grid provenance`

Use `align` with `ifs` and `icon-d2` sources; it keeps both sampled grid points and native-grid provenance so you can judge which differences survive the sampling gap instead of blindly subtracting independently sampled grids.

## Spatial structure

### Follow the wind across the North Sea

> How does wind evolve tomorrow afternoon along a transect from Scotland to Denmark? Is there a coherent ramp, where is the strongest transition, and how uncertain is the timing?

`transect → time evolution → ensemble spread → align models`

Use spatial structure first; avoid drawing a regional conclusion from one point.

## Vertical atmosphere

### Is convection supported?

> What does the atmosphere over Bassano look like from late morning through evening tomorrow? Does the column support convection, and if so how do instability, cloud and wind evolve through the day?

`profiles → parcel diagnostics → time evolution → ensembles → global + regional models`

Build the explanation from the vertical structure instead of starting from a surface verdict.

### How does the column evolve through the day?

> Give me the vertical evolution over Prague tomorrow morning, midday and evening. How do temperature, moisture and wind change with height, and which features are robust across GFS and IFS?

`time series → pressure profiles → layer diagnostics → GFS ↔ IFS`

Useful when the question is about mechanism rather than a single surface variable.

## Ensembles

### What kind of uncertainty dominates?

> How much uncertainty is there in tomorrow afternoon's wind over Prague? Is it mainly about timing, magnitude, or the vertical wind profile?

`ensemble time series → pressure profiles → member distributions → deterministic context`

Separate timing uncertainty from structural uncertainty instead of reporting one spread number.

### How representative is the deterministic run?

> Where does the latest deterministic GFS forecast sit inside GEFS for Prague tomorrow afternoon? Is it near the center of the distribution or toward one of the tails?

`GFS → aligned GEFS → member distribution → previous run if useful`

Use the ensemble to contextualize the deterministic solution rather than assuming it is representative.

## History and verification

### What did the model predict three days ago?

> What did GFS predict three days ago for Prague today, and how well did that forecast verify against the available reference?

`archived forecast → valid-time analysis / radiosonde → error → lead provenance`

Retrieve the historical forecast itself rather than reconstructing it from today's state.

### Have we seen a similar atmosphere before?

> Find historical atmospheric states around Prague that are most similar to tomorrow's forecast profile. Which parts of the setup recur, and which do not?

`forecast state → analog search → inspect matched fields and provenance`

Treat analogs as atmospheric similarity evidence, not automatic outcome forecasts.

## A useful default workflow

```text
question
  → smallest relevant deterministic evidence
  → vertical or spatial structure if needed
  → ensemble evidence if uncertainty matters
  → align runs/models if disagreement matters
  → history/verification if past performance matters
```

Exact capabilities come from [`catalog`](CATALOG_SEARCH.md), not from this page.
