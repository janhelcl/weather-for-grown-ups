# Hermes

## 1. Install WFG

```bash
npm install -g weather-for-grown-ups
wfg --help
```

## 2. Install the skill

```bash
mkdir -p ~/.hermes/skills
git clone --depth 1 https://github.com/janhelcl/weather-for-grown-ups.git /tmp/wfg
cp -R /tmp/wfg/skills/weather-for-grown-ups ~/.hermes/skills/
hermes skills list
```

Start a fresh Hermes session, then ask:

> Determine whether tomorrow afternoon's wind uncertainty near Prague is mainly timing uncertainty or disagreement about the vertical wind structure. Use ensembles rather than a single forecast.

Hermes should use the WFG CLI, discover syntax with `wfg <command> --help`, and discover model capabilities with `wfg catalog`.

## MCP instead

When shell execution is unavailable or WFG is remote:

```bash
npx weather-for-grown-ups mcp
```

Keep the same skill; only the transport changes. See [Installation](../INSTALL.md) for MCP setup.
