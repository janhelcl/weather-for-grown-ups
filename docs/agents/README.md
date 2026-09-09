# WFG for agents

Use **CLI + skill** when the agent has a shell. Use **MCP + the same skill** otherwise.

```text
shell available     → WFG CLI + WFG skill
shell unavailable   → WFG MCP + WFG skill
```

## Install WFG

```bash
npm install -g weather-for-grown-ups
wfg --help
```

Zero-install CLI:

```bash
npx weather-for-grown-ups --help
```

MCP:

```bash
npx weather-for-grown-ups mcp
```

The npm package includes the GRIB2 decoder.

## Install the skill

Canonical source: [`skills/weather-for-grown-ups`](../../skills/weather-for-grown-ups/)

The skill does not wrap WFG. It teaches the agent how to choose models, geometry, profiles, ensembles, comparisons, history and verification; exact syntax comes from CLI help / MCP schemas and exact capabilities come from the WFG catalog.

Pick your harness:

- [Codex](codex.md)
- [Claude Code](claude-code.md)
- [Hermes](hermes.md)
- [OpenClaw](openclaw.md)

## Test it

> What does the atmosphere over Prague look like tomorrow afternoon? Compare GFS and IFS through the boundary layer and free atmosphere, then use GEFS and IFS ENS to show how robust the main features are.

WFG takes coordinates. An agent given only a place name should resolve it with another available capability before querying WFG.

[More example investigations →](../EXAMPLES.md)
