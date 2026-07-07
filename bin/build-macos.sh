#!/usr/bin/env bash
set -euo pipefail

# Usage: build-macos.sh <only-target>
# e.g.   build-macos.sh darwin-x64
#        build-macos.sh darwin-arm64

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#cd "$(dirname "$0")/packages/opencode"

cd "${SCRIPT_DIR}/.."

ONLY_TARGET="${1:?Usage: $0 <only-target>}"
shift

REPO_ROOT="$(pwd)"

# Default outdir to repo root's dist/, unless user provided --outdir=
HAS_OUTDIR=false
for arg in "$@"; do
  case "$arg" in
    --outdir=*) HAS_OUTDIR=true ;;
  esac
done

OUTDIR_ARG=""
if [ "$HAS_OUTDIR" = false ]; then
  OUTDIR_ARG="--outdir=${REPO_ROOT}/dist"
fi

if [ -z "${OPENCODE_VERSION:-}" ]; then
  NEAREST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  if [ -n "$NEAREST_TAG" ]; then
    OPENCODE_VERSION="${NEAREST_TAG#v}"
    echo "👉 OPENCODE_VERSION auto-detected: $OPENCODE_VERSION (from $(git describe --tags --abbrev=0 2>/dev/null))"
  else
    LATEST_TAG="$(git tag -l 'v[0-9]*' | sort -V | tail -1 2>/dev/null || true)"
    if [ -n "$LATEST_TAG" ]; then
      OPENCODE_VERSION="${LATEST_TAG#v}"
      echo "👉 OPENCODE_VERSION auto-detected: $OPENCODE_VERSION (latest tag, not reachable from HEAD)"
    else
      echo "⚠️  No git tag found; OPENCODE_VERSION left unset (build will derive from npm registry)"
    fi
  fi
  export OPENCODE_VERSION
fi

bun run ./packages/opencode/script/build.ts --only="${ONLY_TARGET}" --skip-embed-web-ui $OUTDIR_ARG "$@"
echo "✅ Built: ${OUTDIR_ARG:---outdir=default}/opencode-${ONLY_TARGET}/bin/opencode"
