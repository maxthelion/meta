#!/usr/bin/env bash
# Capture user feedback for a roadmap item.
#
# Usage:
#   scripts/roadmap/capture-feedback.sh <item-id> <applies-to> "raw feedback text"
#   printf 'raw feedback\n' | scripts/roadmap/capture-feedback.sh <item-id> <applies-to>
#
# The created feedback file is deliberately not applied directly. The roadmap
# selector will route the next suitable PM-assistant wakeup to address it.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <item-id> <applies-to> [raw feedback text]" >&2
  exit 2
fi

ITEM_ID="$1"
APPLIES_TO="$2"
shift 2 || true

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

ROADMAP_DIR="$REPO/docs/roadmap"
NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d-%H%M%S")"

frontmatter_value() {
  local file="$1"
  local key="$2"
  local fallback="${3:-}"

  if [ ! -f "$file" ]; then
    printf '%s\n' "$fallback"
    return
  fi

  local value
  value="$(awk -v key="$key" '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && index($0, key ":") == 1 {
      sub("^[^:]+:[[:space:]]*", "")
      print
      exit
    }
  ' "$file")"

  if [ -n "$value" ]; then
    printf '%s\n' "$value" | sed 's/^"//; s/"$//'
  else
    printf '%s\n' "$fallback"
  fi
}

roadmap_dirs() {
  local index="$ROADMAP_DIR/README.md"
  local listed=""

  if [ -f "$index" ]; then
    listed="$(sed -n 's/^- \(**[0-9][0-9]*\*\* \)\{0,1\}\[[^]]*\](\([^)]*\/\))$/\2/p' "$index" | while IFS= read -r rel; do
      rel="${rel%/}"
      if [ -d "$ROADMAP_DIR/$rel" ]; then
        printf '%s\n' "$ROADMAP_DIR/$rel"
      fi
    done)"
  fi

  {
    printf '%s\n' "$listed"
    find "$ROADMAP_DIR" -mindepth 1 -maxdepth 1 -type d | sort
  } | awk 'NF && !seen[$0]++'
}

find_item_dir() {
  while IFS= read -r dir; do
    local readme id
    readme="$dir/README.md"
    id="$(frontmatter_value "$readme" "id" "")"
    if [ "$id" = "$ITEM_ID" ]; then
      printf '%s\n' "$dir"
      return
    fi
  done < <(roadmap_dirs)
}

slugify() {
  printf '%s\n' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/&/and/g; s/[^a-z0-9]/-/g; s/-\{1,\}/-/g; s/^-//; s/-$//'
}

RAW_TEXT=""
if [ "$#" -gt 0 ]; then
  RAW_TEXT="$*"
elif [ ! -t 0 ]; then
  RAW_TEXT="$(cat)"
fi

if [ -z "$RAW_TEXT" ]; then
  echo "No feedback text provided." >&2
  exit 2
fi

ITEM_DIR="$(find_item_dir)"
if [ -z "$ITEM_DIR" ]; then
  echo "No roadmap item found for id $ITEM_ID" >&2
  exit 1
fi

README="$ITEM_DIR/README.md"
TITLE="$(frontmatter_value "$README" "title" "$(basename "$ITEM_DIR")")"
FEEDBACK_DIR="$ITEM_DIR/feedback"
SAFE_SCOPE="$(slugify "$APPLIES_TO")"
FEEDBACK_FILE="$FEEDBACK_DIR/$STAMP-$SAFE_SCOPE-feedback.md"
INTENT="$ROADMAP_DIR/intent.md"

mkdir -p "$FEEDBACK_DIR"

{
  echo "---"
  echo "status: new"
  echo "applies_to: $APPLIES_TO"
  echo "created: $NOW_ISO"
  echo "handled_by: null"
  echo "handled_in: []"
  echo "---"
  echo
  echo "# $TITLE Feedback"
  echo
  echo "Raw feedback:"
  echo
  echo '```text'
  printf '%s\n' "$RAW_TEXT"
  echo '```'
} > "$FEEDBACK_FILE"

{
  echo
  echo "## $NOW_ISO - $TITLE Feedback"
  echo
  echo "- **Applies to:** $APPLIES_TO"
  echo "- **Feedback file:** \`docs/roadmap/$(basename "$ITEM_DIR")/feedback/$(basename "$FEEDBACK_FILE")\`"
  echo
  echo "Raw input:"
  echo
  echo '```text'
  printf '%s\n' "$RAW_TEXT"
  echo '```'
} >> "$INTENT"

scripts/roadmap/next-roadmap-actions.sh >/dev/null
scripts/roadmap/attention-summary.sh

echo "Captured feedback for item $ITEM_ID: $TITLE"
echo "Feedback: docs/roadmap/$(basename "$ITEM_DIR")/feedback/$(basename "$FEEDBACK_FILE")"
