# Installation and distribution

Weather for Grown Ups is designed to work directly from npm with no separate GRIB installation. CLI and both MCP transports use the same package and core.

## npx — recommended

With Node.js 20 or newer installed, no WFG installation step is required:

```bash
npx weather-for-grown-ups --help
```

Run any CLI operation by putting its arguments after the package name:

```bash
npx weather-for-grown-ups catalog --search cloud --json
npx weather-for-grown-ups profile --lat 50.08 --lon 14.43 --valid 2026-08-24T12:00:00Z --vars temperature,wind --levels 850,700,500 --json
```

The npm package includes its GRIB2 decoder, so `wgrib2` does **not** need to be installed on the host.

### stdio MCP with npx

Start the local stdio MCP server with the same package:

```bash
npx weather-for-grown-ups mcp
```

Example MCP client configuration:

```json
{
  "command": "npx",
  "args": ["-y", "weather-for-grown-ups", "mcp"]
}
```

`-y` lets a process-spawned MCP client accept npm's first-run package installation prompt non-interactively.

### Streamable HTTP MCP with npx

```bash
npx weather-for-grown-ups mcp-http
```

The safe default is loopback-only at `127.0.0.1:3000`. For a hosted service, explicitly configure the bind address and accepted public Host values:

```bash
WFG_MCP_HOST=0.0.0.0 \
WFG_MCP_ALLOWED_HOSTS=weather.example.com \
npx weather-for-grown-ups mcp-http
```

The MCP endpoint is `/mcp`; `GET /healthz` is a small process health check. Browser callers that send an `Origin` header must also configure `WFG_MCP_ALLOWED_ORIGINS` as a comma-separated hostname allowlist.

WFG deliberately refuses a non-loopback HTTP bind without `WFG_MCP_ALLOWED_HOSTS`. The HTTP transport itself does not authenticate callers; put public deployments behind an authentication-capable reverse proxy/platform boundary rather than exposing an unrestricted NOAA-backed endpoint directly.

HTTP configuration:

- `WFG_MCP_HOST` — bind address, default `127.0.0.1`
- `WFG_MCP_PORT` — TCP port, default `3000`
- `WFG_MCP_ALLOWED_HOSTS` — comma-separated accepted Host header hostnames; required for non-loopback binds
- `WFG_MCP_ALLOWED_ORIGINS` — optional comma-separated browser Origin hostnames; when absent on a non-loopback bind, requests carrying an Origin header are rejected

## Global npm install

A global install is optional when repeated local CLI use is more convenient:

```bash
npm install -g weather-for-grown-ups
weather-for-grown-ups --help
```

The shorter compatibility executables remain available:

```bash
wfg --help
wfg-mcp
wfg-mcp-http
```

The package's default GRIB2 engine is bundled through npm. Native `wgrib2` remains an opt-in compatibility/debug path: set `WGRIB2_PATH=/path/to/wgrib2`, or set `WFG_DECODER=wgrib2` to use `wgrib2` from `PATH`.

WFG currently targets Node.js 20 or newer.

## Docker

Docker remains useful for pinned/reproducible deployments. The image contains Node.js 24 and native `wgrib2 3.8.0` from conda-forge.

After a tagged image is published to GHCR:

```bash
docker run --rm ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 catalog --search cloud --json
```

The image entrypoint runs the `wfg` CLI by default, so all normal CLI arguments follow the image name.

For the stdio MCP surface:

```bash
docker run -i --rm ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 mcp
```

Example stdio MCP client configuration:

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "ghcr.io/janhelcl/weather-for-grown-ups:0.1.0",
    "mcp"
  ]
}
```

For Streamable HTTP:

```bash
docker run --rm -p 3000:3000 \
  -e WFG_MCP_HOST=0.0.0.0 \
  -e WFG_MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 mcp-http
```

## Publishing

`npm run pack:check` builds the package and shows exactly what npm would publish. `npm publish` also runs the typecheck, deterministic tests, build, and CLI smoke suite through `prepublishOnly`.

Tagged releases are intended to publish the matching container image to GitHub Container Registry. npm publication remains a separate explicit release action so package ownership/credentials are never hidden in ordinary CI.

Before publishing, the release checks should verify the packed tarball rather than only the repository checkout: install the tarball into a clean temporary directory and invoke `weather-for-grown-ups --help` from its generated npm bin. That catches missing `files`, `bin`, or runtime dependency metadata before a release reaches npm.

## Licensing note

The WFG source repository is MIT licensed. The npm package includes `@mattnucc/gribberish`, which is also MIT licensed. The Docker image additionally contains the separately distributed `wgrib2` executable from conda-forge; its package metadata declares GPL-2.0-or-later. Keep upstream license metadata intact when redistributing the image.
