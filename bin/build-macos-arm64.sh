#!/usr/bin/env bash
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/build-macos.sh" darwin-arm64 "$@"
