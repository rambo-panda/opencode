#!/usr/bin/env bash
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/build-macos.sh" darwin-x64 --skip-web-ui --skip-install "$@"
