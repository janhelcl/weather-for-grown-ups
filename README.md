# Weather for Grown Ups

**Weather is the hello-world of agent tools. WFG is for when “temperature tomorrow” stops being enough.**

One query language for operational NWP: global and regional models, deterministic and ensemble forecasts, physics and AI, current runs and history.

> **Ask the same atmospheric question across models without flattening what makes the models different.**

## 30-second start

Requires Node.js 20+.

```bash
npx weather-for-grown-ups catalog --dataset all --search wind --json

npx weather-for-grown-ups query \
  --dataset gfs \
  --lat 50.08 --lon 14.43 \
  --at 2026-08-24T12:00:00Z \
  --vars temperature,wind \
  --levels 850,700,500 \
  --json
```

For repeated use:

```bash
npm install -g weather-for-grown-ups
wfg --help
```

## The contract

Normal atmospheric access is four orthogonal choices:

```text
dataset × geometry × time × selection
```

```json
{
  "dataset": "gefs",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-08-30T12:00:00Z"
  },
  "selection": {
    "variables": ["temperature", "wind"],
    "pressureLevelsHpa": [850, 700, 500]
  },
  "ensemble": {
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

Change the dataset; keep the question. Unsupported combinations fail rather than being coerced into fake symmetry.

[Read the unified atmospheric API →](docs/UNIFIED_API.md)

## Ask harder questions

Start with the question. Let the agent build the forecast investigation from scratch.

### 01 — Give me the serious forecast

> What does the atmosphere over Prague look like tomorrow afternoon? Cover the surface and vertical structure, compare the main global guidance, and show which parts are robust across the ensembles.

`GFS + IFS → pressure profiles → GEFS + IFS ENS → regional model if useful`

### 02 — Is a front coming?

> Is a frontal passage expected near Prague tomorrow? If so, when does it arrive, what changes through the column, and how consistent are the models?

`GFS + IFS → time evolution → pressure profiles → GEFS + IFS ENS → align latest vs previous runs`

### 03 — AI vs physics

> How do AIFS and IFS describe the atmosphere over Prague tomorrow? Where do they disagree through time and height, and is that disagreement large relative to their ensemble uncertainty?

`align IFS, AIFS → pressure profiles → align IFS ENS, AIFS ENS`

### 04 — Plan a paragliding day

> I’m planning to paraglide around Bassano tomorrow. How does the convective window develop through the day, what do the wind profile and stability look like, and how robust is the picture across ensembles and global/regional guidance?

`profiles → parcel diagnostics → wind through the column → time evolution → ensembles → global + regional models`

### 05 — Verify an old forecast

> What did GFS predict three days ago for Prague today, and how well did that forecast verify?

`archived forecast → analysis / radiosonde → error → lead provenance`

[Explore the investigation gallery →](docs/EXAMPLES.md)

## Models

**GFS · GEFS · AIGFS · AIGEFS · HGEFS · IFS · IFS ENS · AIFS · AIFS ENS · ICON-D2 · ICON-D2-EPS · AROME · PE-AROME · GFS analysis · GEFSv12 reforecast**

Capabilities come from the catalog. Native grids, cadence, domains, members, fields and provenance remain explicit.

```bash
wfg catalog --dataset all --json
```

## Agents

WFG exposes the same core through CLI and MCP.

**Shell available → CLI.**  
**No shell / remote → MCP.**

```bash
npx weather-for-grown-ups mcp
```

Add the portable [WFG skill](skills/weather-for-grown-ups/SKILL.md), then pick a setup guide: [Codex](docs/agents/codex.md) · [Claude Code](docs/agents/claude-code.md) · [Hermes](docs/agents/hermes.md) · [OpenClaw](docs/agents/openclaw.md) · [other agents](docs/agents/README.md)

## Go deeper

[Examples](docs/EXAMPLES.md) · [Installation](docs/INSTALL.md) · [API contract](docs/UNIFIED_API.md) · [Catalog](docs/CATALOG_SEARCH.md) · [History](docs/HISTORY.md) · [Architecture](docs/ARCHITECTURE.md) · [All docs](docs/README.md)

## License

MIT. See [LICENSE](LICENSE).
