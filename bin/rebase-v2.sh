#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 [base-commit]"
  echo "Fetch the latest official stable V2 release, back up the current branch, and rebase personal commits."
  echo "On conflicts: resolve and run git rebase --continue, or git rebase --abort."
  exit 0
fi
if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [base-commit]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
BRANCH="$(git symbolic-ref --quiet --short HEAD)" || {
  echo "Switch to your personal branch first." >&2
  exit 1
}
for operation in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  if [ -e "$(git rev-parse --git-path "$operation")" ]; then
    echo "Finish or abort the existing Git operation first." >&2
    exit 1
  fi
done
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash tracked changes before rebasing. Untracked files are left in place." >&2
  exit 1
fi

# Stable release version-sync commits are tagged without joining the V2 branch.
BASE="${1:-$(git describe --tags --abbrev=0 --match 'v2.*' HEAD)}"
BASE="$(git rev-parse --verify "${BASE}^{commit}")"
if ! git merge-base --is-ancestor "$BASE" HEAD; then
  echo "The base must be an ancestor of the current branch." >&2
  exit 1
fi

VERSION="$(curl --connect-timeout 10 --max-time 60 -fsSL https://opencode.ai/update/api/latest/cli/npm | bun -e '
const release = await Bun.stdin.json()
if (release.channel !== "latest" || release.name !== "cli" || !/^2\.\d+\.\d+$/.test(release.version))
  throw new Error("Expected an official stable V2 CLI release")
console.log(release.version)
')"
git fetch --no-tags upstream '+refs/heads/v2:refs/remotes/upstream/v2' "refs/tags/v${VERSION}:refs/tags/v${VERSION}"
TARGET="$(git rev-parse "v${VERSION}^{commit}")"
if [ "$BASE" = "$TARGET" ]; then
  echo "$BRANCH already uses the latest stable V2 release ($VERSION). Nothing was rebased."
  exit 0
fi

BACKUP="v2-backup-$(date +%Y%m%d%H%M%S)"
git branch "$BACKUP" HEAD
echo "Rebasing $BRANCH onto v$VERSION ($TARGET); backup: $BACKUP"
if ! git rebase --onto "$TARGET" "$BASE"; then
  echo "Rebase stopped. Resolve conflicts and run git rebase --continue, or git rebase --abort." >&2
  echo "Original branch tip is saved as $BACKUP. No commits were automatically skipped." >&2
  exit 1
fi
echo "Rebased $BRANCH onto stable V2 $VERSION. Nothing was pushed."
