# OpenClaw

## 1. Install WFG

```bash
npm install -g weather-for-grown-ups
wfg --help
```

## 2. Install the skill

```bash
git clone --depth 1 https://github.com/janhelcl/weather-for-grown-ups.git /tmp/wfg
openclaw skills install /tmp/wfg/skills/weather-for-grown-ups --as weather-for-grown-ups
openclaw skills list
```

Then ask:

> Is a frontal passage expected near Prague tomorrow? If so, follow it through the vertical profile, then inspect ensemble timing spread and whether recent runs are converging.

With shell access, OpenClaw should use the WFG CLI, discover syntax with `wfg <command> --help`, and discover model capabilities with `wfg catalog`.

## MCP instead

When shell execution is unavailable or WFG is remote:

```bash
npx weather-for-grown-ups mcp
```

Keep the same skill; only the transport changes. See [Installation](../INSTALL.md) for MCP setup.
