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
npx weather-for-grown-ups query --dataset gfs --lat 50.08 --lon 14.43 --at 2026-08-24T12:00:00Z --vars temperature,wind --levels 850,700,500 --json
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
docker run --rm ghcr.io/janhelcl/weather-for-grown-ups:0.2.0 catalog --search cloud --json
```

The image entrypoint runs the `wfg` CLI by default, so all normal CLI arguments follow the image name.

For the stdio MCP surface:

```bash
docker run -i --rm ghcr.io/janhelcl/weather-for-grown-ups:0.2.0 mcp
```

Example stdio MCP client configuration:

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "ghcr.io/janhelcl/weather-for-grown-ups:0.2.0",
    "mcp"
  ]
}
```

For Streamable HTTP:

```bash
docker run --rm -p 3000:3000 \
  -e WFG_MCP_HOST=0.0.0.0 \
  -e WFG_MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  ghcr.io/janhelcl/weather-for-grown-ups:0.2.0 mcp-http
```

## Publishing

`npm run pack:check` builds the package and shows exactly what npm would publish. Normal CI also packs the tarball, installs it into a clean temporary prefix, and invokes the package-name executable so missing `files`, `bin`, or runtime dependency metadata is caught before release.

Tags matching `v*` drive both release surfaces:

- `.github/workflows/release-image.yml` publishes the matching multi-architecture image to GitHub Container Registry.
- `.github/workflows/release-npm.yml` verifies that the tag exactly matches `package.json` (for example `v0.2.0`), verifies the packed npm payload, and publishes the package to npm.

The npm workflow is set up for npm Trusted Publishing through GitHub Actions OIDC. Configure the package's npm Trusted Publisher with:

- provider: GitHub Actions
- repository owner/user: `janhelcl`
- repository: `weather-for-grown-ups`
- workflow filename: `release-npm.yml`
- allowed action: `npm publish`

No long-lived npm publish token is stored in GitHub once Trusted Publishing is configured. The workflow uses GitHub's `id-token: write` permission and Node.js 24. npm automatically attaches provenance for a public package published from this public GitHub repository through Trusted Publishing.

### First npm release

npm requires a package to already exist before a Trusted Publisher can be attached. For the first-ever publication of `weather-for-grown-ups`, bootstrap package ownership once with an authenticated manual `npm publish` from a clean, tested checkout (npm requires account 2FA or an appropriately configured granular token for direct publishing). Then configure the Trusted Publisher above before relying on tag-driven releases.

The tag workflow is intentionally idempotent: if that exact package version already exists on npm because it was used for the bootstrap publication, the workflow treats it as already released instead of attempting an impossible duplicate publish. Subsequent versions should be published only through the trusted tag workflow.

## Licensing note

The WFG source repository is MIT licensed. The npm package includes `@mattnucc/gribberish`, which is also MIT licensed. The Docker image additionally contains the separately distributed `wgrib2` executable from conda-forge; its package metadata declares GPL-2.0-or-later. Keep upstream license metadata intact when redistributing the image.
