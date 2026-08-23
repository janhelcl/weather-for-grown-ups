#!/bin/sh
set -eu

case "${1:-}" in
  mcp)
    shift
    exec node /app/dist/mcp.js "$@"
    ;;
  *)
    exec node /app/dist/cli.js "$@"
    ;;
esac
