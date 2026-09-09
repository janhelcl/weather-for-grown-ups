# Codex

## 1. Install WFG

```bash
npm install -g weather-for-grown-ups
wfg --help
```

## 2. Install the skill

```bash
mkdir -p ~/.codex/skills
git clone --depth 1 https://github.com/janhelcl/weather-for-grown-ups.git /tmp/wfg
cp -R /tmp/wfg/skills/weather-for-grown-ups ~/.codex/skills/
```

Start a new Codex session, then ask:

> Compare tomorrow afternoon's vertical wind structure around Prague in GFS and IFS. If they disagree, inspect their ensembles before drawing a conclusion.

Codex should use the WFG CLI, discover exact syntax with `wfg <command> --help`, and discover model capabilities with `wfg catalog`.

## MCP instead

When shell execution is unavailable or WFG is remote:

```bash
npx weather-for-grown-ups mcp
```

Keep the same skill; only the transport changes. See [Installation](../INSTALL.md) for the generic MCP process configuration.
