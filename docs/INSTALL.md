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

The npm package includes its GRIB2 decoder for the normal dataset set, so native weather tooling is not required on the host. **ICON-D2-EPS is the current exception:** DWD exposes that ensemble on its provider-native triangular grid. WFG follows DWD's official conversion path with CDO plus the provider target-grid/weights bundle, then uses `wgrib2` for member extraction and regular-grid sampling. Use the Docker image for a zero-setup ICON-D2-EPS path, or install `cdo` and `wgrib2`; `CDO_PATH` and `WGRIB2_PATH` may override their executable locations.

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

The package's default GRIB2 engine is bundled through npm. Native tooling remains optional for the regular datasets. `dataset: "icon-d2-eps"` currently requires both CDO and `wgrib2`: CDO applies DWD's official ICON-D2 0.02° target grid and nearest-neighbour weights, then `wgrib2` selects/samples individual ensemble members. Set `CDO_PATH=/path/to/cdo` and/or `WGRIB2_PATH=/path/to/wgrib2`, or ensure both executables are on `PATH`.

WFG currently targets Node.js 20 or newer.

## Docker

Docker remains useful for pinned/reproducible deployments. The image contains Node.js 24, CDO and native `wgrib2 3.8.0` from conda-forge.

The release workflow publishes both an exact semver image and a moving minor-version alias. The examples below use the current `0.4` alias:

```bash
docker run --rm ghcr.io/janhelcl/weather-for-grown-ups:0.4 catalog --search cloud --json
```

The image entrypoint runs the `wfg` CLI by default, so all normal CLI arguments follow the image name.

For the stdio MCP surface:

```bash
docker run -i --rm ghcr.io/janhelcl/weather-for-grown-ups:0.4 mcp
```

Example stdio MCP client configuration:

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "ghcr.io/janhelcl/weather-for-grown-ups:0.4",
    "mcp"
  ]
}
```

For Streamable HTTP:

```bash
docker run --rm -p 3000:3000 \
  -e WFG_MCP_HOST=0.0.0.0 \
  -e WFG_MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  ghcr.io/janhelcl/weather-for-grown-ups:0.4 mcp-http
```

## Publishing

`npm run pack:check` builds the package and shows exactly what npm would publish. Normal CI also packs the tarball, installs it into a clean temporary prefix, and invokes the package-name executable so missing `files`, `bin`, or runtime dependency metadata is caught before release.

Tags matching `v*` drive both release surfaces:

- `.github/workflows/release-image.yml` publishes the matching multi-architecture image to GitHub Container Registry.
- `.github/workflows/release-npm.yml` verifies that a `vX.Y.Z` tag exactly matches the `X.Y.Z` version in `package.json`, verifies the packed npm payload, and publishes the package to npm.

The npm workflow is set up for npm Trusted Publishing through GitHub Actions OIDC. Configure the package's npm Trusted Publisher with:

- provider: GitHub Actions
- repository owner/user: `janhelcl`
- repository: `weather-for-grown-ups`
- workflow filename: `release-npm.yml`
- allowed action: `npm publish`

No long-lived npm publish token is stored in GitHub once Trusted Publishing is configured. The workflow uses GitHub's `id-token: write` permission and Node.js 24. npm automatically attaches provenance for a public package published from this public GitHub repository through Trusted Publishing.

## Licensing note

The WFG source repository is MIT licensed. The npm package includes `@mattnucc/gribberish`, which is also MIT licensed. The Docker image additionally contains the separately distributed `wgrib2` executable from conda-forge; its package metadata declares GPL-2.0-or-later. Keep upstream license metadata intact when redistributing the image.
