#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 [base-commit]"
  echo "Fetch upstream/beta, back up the current branch, and rebase personal commits."
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

# Resolve the old upstream base before fetch moves the remote-tracking ref.
BASE="${1:-$(git merge-base --fork-point refs/remotes/upstream/beta HEAD || true)}"
if [ -z "$BASE" ]; then
  echo "Cannot identify the beta base. Pass the last upstream commit explicitly." >&2
  exit 1
fi
BASE="$(git rev-parse --verify "${BASE}^{commit}")"
if ! git merge-base --is-ancestor "$BASE" HEAD; then
  echo "The base must be an ancestor of the current branch." >&2
  exit 1
fi

git fetch --no-tags upstream '+refs/heads/beta:refs/remotes/upstream/beta'
TARGET="$(git rev-parse refs/remotes/upstream/beta)"
BACKUP="beta-backup-$(date +%Y%m%d%H%M%S)"
git branch "$BACKUP" HEAD
echo "Rebasing $BRANCH onto $TARGET; backup: $BACKUP"
if ! git rebase --onto "$TARGET" "$BASE"; then
  echo "Rebase stopped. Resolve conflicts and run git rebase --continue, or git rebase --abort." >&2
  echo "Original branch tip is saved as $BACKUP. No commits were automatically skipped." >&2
  exit 1
fi
echo "Rebased $BRANCH onto upstream/beta. Nothing was pushed."
