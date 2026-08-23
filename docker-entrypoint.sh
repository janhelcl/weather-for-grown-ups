#!/bin/sh
set -eu

case "${1:-}" in
  mcp)
    shift
    exec node /app/dist/mcp.js "$@"
    ;;
  mcp-http)
    shift
    exec node /app/dist/mcp-http.js "$@"
    ;;
  *)
    exec node /app/dist/cli.js "$@"
    ;;
esac
