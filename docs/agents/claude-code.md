# Claude Code

## 1. Install WFG

```bash
npm install -g weather-for-grown-ups
wfg --help
```

## 2. Install the skill

Personal:

```bash
mkdir -p ~/.claude/skills
git clone --depth 1 https://github.com/janhelcl/weather-for-grown-ups.git /tmp/wfg
cp -R /tmp/wfg/skills/weather-for-grown-ups ~/.claude/skills/
```

Project-local:

```text
.claude/skills/weather-for-grown-ups/SKILL.md
```

Start a new Claude Code session, then ask:

> How does wind over Prague evolve tomorrow afternoon through the surface and pressure levels? Compare GFS and IFS, then use their ensembles to show where the forecast is robust and where it is not.

Claude Code should use the WFG CLI, discover syntax with `wfg <command> --help`, and discover model capabilities with `wfg catalog`.

## MCP instead

When shell execution is unavailable or WFG is remote:

```bash
npx weather-for-grown-ups mcp
```

Keep the same skill; only the transport changes. See [Installation](../INSTALL.md) for the generic MCP process configuration.
