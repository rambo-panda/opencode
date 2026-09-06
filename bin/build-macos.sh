#!/usr/bin/env bash
set -euo pipefail

# Usage: build-macos.sh <only-target>
# e.g.   build-macos.sh darwin-x64
#        build-macos.sh darwin-arm64

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#cd "$(dirname "$0")/packages/opencode"

download_models_snapshot() {
  local output="$1"

  if curl --fail --location --silent --show-error --connect-timeout 5 --max-time 30 \
    https://models.dev/api.json --output "$output" 2>/dev/null; then
    return
  fi

  local models_dev_ip
  models_dev_ip="$(
    curl --fail --location --silent --show-error --connect-timeout 5 --max-time 15 \
      'https://dns.google/resolve?name=models.dev&type=A' 2>/dev/null \
      | bun -e 'const data = await Bun.stdin.json(); console.log(data.Answer?.find((item) => item.type === 1)?.data ?? "")' \
      2>/dev/null || true
  )"
  if [ -z "$models_dev_ip" ]; then
    return 1
  fi

  curl --fail --location --silent --show-error --connect-timeout 5 --max-time 30 \
    --connect-to "models.dev:443:${models_dev_ip}:443" \
    https://models.dev/api.json --output "$output" 2>/dev/null
}

cleanup() {
  if [ -n "${MODELS_DEV_SNAPSHOT:-}" ]; then
    rm -f "$MODELS_DEV_SNAPSHOT"
  fi
}

trap cleanup EXIT

cd "${SCRIPT_DIR}/.."

ONLY_TARGET="${1:?Usage: $0 <only-target>}"
shift

REPO_ROOT="$(pwd)"

MODELS_DEV_SNAPSHOT=""
if [ -z "${MODELS_DEV_API_JSON:-}" ]; then
  MODELS_DEV_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/opencode-models.XXXXXX")"
  if download_models_snapshot "$MODELS_DEV_SNAPSHOT"; then
    MODELS_DEV_API_JSON="$MODELS_DEV_SNAPSHOT"
    echo "👉 Downloaded current models.dev snapshot"
  else
    rm -f "$MODELS_DEV_SNAPSHOT"
    MODELS_DEV_SNAPSHOT=""
    MODELS_DEV_API_JSON="${REPO_ROOT}/packages/opencode/test/tool/fixtures/models-api.json"
    echo "⚠️  models.dev unavailable; using bundled snapshot"
  fi
  export MODELS_DEV_API_JSON
fi

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
  git fetch upstream --tags
  BASE_TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD 2>/dev/null || true)"
  if [ -n "$BASE_TAG" ]; then
    OPENCODE_VERSION="$BASE_TAG"
    echo "👉 OPENCODE_VERSION auto-detected: $OPENCODE_VERSION (from current branch base tag)"
  else
    echo "⚠️  No stable tag is reachable from HEAD; OPENCODE_VERSION left unset (build will derive from npm registry)"
  fi
  export OPENCODE_VERSION
fi

bun run ./packages/opencode/script/build.ts --only="${ONLY_TARGET}" --skip-embed-web-ui $OUTDIR_ARG "$@"
echo "✅ Built: ${OUTDIR_ARG:---outdir=default}/opencode-${ONLY_TARGET}/bin/opencode"
