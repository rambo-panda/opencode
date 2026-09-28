#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ] || [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 <darwin-arm64|darwin-x64|darwin-x64-baseline> [build flags]"
  echo "Builds opencode2 in dist/cli-<target>/bin/. Pass --outdir=/path to override."
  exit 0
fi
TARGET="$1"
shift
case "$TARGET" in
  darwin-arm64|darwin-x64|darwin-x64-baseline) ;;
  *) echo "Unsupported macOS target: $TARGET" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
OUTDIR="${REPO_ROOT}/dist"
BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --outdir=*) OUTDIR="${arg#--outdir=}" ;;
    --target=*|--only=*|--single|--baseline) echo "Select the target using the first argument; use the CLI builder directly for --only." >&2; exit 1 ;;
    --skip-embed-web-ui) BUILD_ARGS+=(--skip-web-ui) ;;
    *) BUILD_ARGS+=("$arg") ;;
  esac
done
if [ -z "$OUTDIR" ]; then
  echo "--outdir cannot be empty." >&2
  exit 1
fi
case "$OUTDIR" in
  /*) ;;
  *) OUTDIR="${REPO_ROOT}/${OUTDIR}" ;;
esac

BUN_VERSION="$(bun -p 'JSON.parse(await Bun.file("package.json").text()).packageManager.split("@")[1]')"
BUN=(bun)
if [ "$(bun --version)" != "$BUN_VERSION" ]; then
  BUN=(npm exec --yes --package="bun@${BUN_VERSION}" -- bun)
fi
if [ "${OPENCODE_CHANNEL:-local}" != "local" ]; then
  echo "build-macos.sh requires OPENCODE_CHANNEL=local to keep its binary and database separate." >&2
  exit 1
fi
export OPENCODE_CHANNEL=local
if [ -z "${OPENCODE_VERSION:-}" ]; then
  BASE="$(git merge-base upstream/beta HEAD)"
  OPENCODE_VERSION="$("${BUN[@]}" - "$BASE" <<'JS'
const base = process.argv[2]
const response = await fetch(
  `https://api.github.com/repos/anomalyco/opencode/actions/workflows/publish.yml/runs?branch=beta&head_sha=${base}&status=success&per_page=5`,
  { headers: { Accept: "application/vnd.github+json" } },
)
if (!response.ok) throw new Error(`Cannot resolve official beta version: GitHub HTTP ${response.status}`)
const runs = await response.json()
const run = runs.workflow_runs.find((run) => run.head_sha === base && run.conclusion === "success")
if (!run) throw new Error(`No successful beta build found for ${base}; set OPENCODE_VERSION explicitly`)
const version = `0.0.0-beta-${run.run_number}${run.run_attempt > 1 ? `.${run.run_attempt}` : ""}`
console.log(version)
JS
)"
fi
export OPENCODE_VERSION

# The local channel builds the V2 entrypoint as opencode2.
# This command does not fetch Git branches, rebase, install the app, or change configuration.
"${BUN[@]}" run ./packages/cli/script/build.ts --target="opencode2-${TARGET}" --outdir="$OUTDIR" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
echo "Built: ${OUTDIR}/cli-${TARGET}/bin/opencode2"
