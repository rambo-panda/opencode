#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#cd "$(dirname "$0")/packages/opencode"

cd "${SCRIPT_DIR}/.."

bun run ./packages/opencode/script/build.ts --only=darwin-arm64 --skip-embed-web-ui "$@"
echo "✅ Built: $(pwd)/dist/opencode-darwin-x64/bin/opencode"

