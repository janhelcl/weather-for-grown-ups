# Installation and distribution

Weather for Grown Ups has two supported distribution paths and two equal MCP transports: stdio for local process-spawned clients and Streamable HTTP for hosted clients.

## Docker (recommended, includes `wgrib2`)

The container is the zero-host-dependency path. It contains Node.js plus `wgrib2 3.8.0` from conda-forge.

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

For Streamable HTTP, the safe default is loopback-only at `127.0.0.1:3000`. A container or hosted service normally binds all interfaces and must explicitly declare the public Host values it accepts:

```bash
docker run --rm -p 3000:3000 \
  -e WFG_MCP_HOST=0.0.0.0 \
  -e WFG_MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  ghcr.io/janhelcl/weather-for-grown-ups:0.1.0 mcp-http
```

The MCP endpoint is `/mcp`; `GET /healthz` is a small process health check. For a real hosted deployment, replace the example allowlist with the service's actual public hostname. Browser callers that send an `Origin` header must also configure `WFG_MCP_ALLOWED_ORIGINS` as a comma-separated hostname allowlist.

WFG deliberately refuses a non-loopback HTTP bind without `WFG_MCP_ALLOWED_HOSTS`. The HTTP transport itself does not authenticate callers; put public deployments behind an authentication-capable reverse proxy/platform boundary rather than exposing an unrestricted NOAA-backed endpoint directly.

HTTP configuration:

- `WFG_MCP_HOST` — bind address, default `127.0.0.1`
- `WFG_MCP_PORT` — TCP port, default `3000`
- `WFG_MCP_ALLOWED_HOSTS` — comma-separated accepted Host header hostnames; required for non-loopback binds
- `WFG_MCP_ALLOWED_ORIGINS` — optional comma-separated browser Origin hostnames; when absent on a non-loopback bind, requests carrying an Origin header are rejected

## npm

The npm package provides the native `wfg`, `wfg-mcp`, and `wfg-mcp-http` executables:

```bash
npm install -g weather-for-grown-ups
wfg --help
wfg-mcp
wfg-mcp-http
```

The npm route intentionally does not compile or install a native GRIB tool during `npm install`. `wgrib2` must already be available on `PATH`; WFG's Docker image is the recommended route when you do not want to manage that dependency yourself.

One convenient host install is conda-forge:

```bash
conda install -c conda-forge wgrib2
```

WFG currently targets Node.js 20 or newer. The container pins Node.js 24 and `wgrib2 3.8.0` for a reproducible runtime.

## Publishing

`npm run pack:check` builds the package and shows exactly what npm would publish. `npm publish` also runs the typecheck, deterministic tests, build, and CLI smoke suite through `prepublishOnly`.

Tagged releases are intended to publish the matching container image to GitHub Container Registry. npm publication remains a separate explicit release action so package ownership/credentials are never hidden in ordinary CI.

## Licensing note

The WFG source repository is MIT licensed. The Docker image also contains the separately distributed `wgrib2` executable from conda-forge; its package metadata declares GPL-2.0-or-later. Keep the upstream license metadata intact when redistributing the image.
