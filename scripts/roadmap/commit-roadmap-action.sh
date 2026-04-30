#!/usr/bin/env bash
# Commit completed roadmap PM work.
#
# The PM heartbeat may update docs/roadmap/next-actions.md every wakeup. This
# helper only commits when there are meaningful roadmap artifact changes beyond
# that generated queue file.

set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

ROADMAP_DIR="docs/roadmap"
GENERATED_QUEUE="$ROADMAP_DIR/next-actions.md"

if [ ! -d "$ROADMAP_DIR" ]; then
  echo "Missing roadmap directory: $ROADMAP_DIR" >&2
  exit 1
fi

meaningful_changed_files() {
  {
    git diff --name-only -- "$ROADMAP_DIR"
    git ls-files --others --exclude-standard -- "$ROADMAP_DIR"
  } | awk -v generated="$GENERATED_QUEUE" 'NF && $0 != generated && !seen[$0]++'
}

changed="$(meaningful_changed_files)"

if [ -z "$changed" ]; then
  echo "No roadmap artifact changes to commit."
  exit 0
fi

git add "$ROADMAP_DIR"

staged_meaningful="$(
  git diff --cached --name-only -- "$ROADMAP_DIR" \
    | awk -v generated="$GENERATED_QUEUE" 'NF && $0 != generated && !seen[$0]++'
)"

if [ -z "$staged_meaningful" ]; then
  echo "No staged roadmap artifact changes to commit."
  exit 0
fi

first_file="$(printf '%s\n' "$staged_meaningful" | head -1)"
feature_slug="$(printf '%s\n' "$first_file" | awk -F/ 'NF >= 3 { print $3 }')"

if [ -n "$feature_slug" ] && [ "$feature_slug" != "$(basename "$first_file")" ]; then
  message="docs(roadmap): advance ${feature_slug}"
else
  message="docs(roadmap): advance pm artifacts"
fi

git commit -m "$message" -- "$ROADMAP_DIR"
