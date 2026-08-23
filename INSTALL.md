# Installation and distribution

Weather for Grown Ups has two supported distribution paths.

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

Example MCP client configuration:

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

## npm

The npm package provides the native `wfg` and `wfg-mcp` executables:

```bash
npm install -g weather-for-grown-ups
wfg --help
wfg-mcp
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
