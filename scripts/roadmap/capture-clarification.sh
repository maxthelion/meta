#!/usr/bin/env bash
# Capture a user clarification for a roadmap item.
#
# Usage:
#   scripts/roadmap/capture-clarification.sh <item-id> "raw clarification text"
#   printf 'raw clarification\n' | scripts/roadmap/capture-clarification.sh <item-id>

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <item-id> [raw clarification text]" >&2
  exit 2
fi

ITEM_ID="$1"
shift || true

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

ROADMAP_DIR="$REPO/docs/roadmap"
TODAY="$(date +%Y-%m-%d)"

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

update_frontmatter() {
  local readme="$1"
  local tmp="$readme.tmp.$$"

  awk -v today="$TODAY" '
    NR == 1 && $0 == "---" { in_fm = 1; print; next }
    in_fm && $0 == "---" {
      if (!saw_status) print "status: inventory"
      if (!saw_stage) print "stage: draft-user-stories"
      if (!saw_updated) print "updated: " today
      in_fm = 0
      print
      next
    }
    in_fm && $0 ~ /^status:/ { print "status: inventory"; saw_status = 1; next }
    in_fm && $0 ~ /^stage:/ { print "stage: draft-user-stories"; saw_stage = 1; next }
    in_fm && $0 ~ /^updated:/ { print "updated: " today; saw_updated = 1; next }
    { print }
  ' "$readme" > "$tmp"
  mv -f "$tmp" "$readme"
}

RAW_TEXT=""
if [ "$#" -gt 0 ]; then
  RAW_TEXT="$*"
elif [ ! -t 0 ]; then
  RAW_TEXT="$(cat)"
fi

if [ -z "$RAW_TEXT" ]; then
  echo "No clarification text provided." >&2
  exit 2
fi

ITEM_DIR="$(find_item_dir)"
if [ -z "$ITEM_DIR" ]; then
  echo "No roadmap item found for id $ITEM_ID" >&2
  exit 1
fi

README="$ITEM_DIR/README.md"
TITLE="$(frontmatter_value "$README" "title" "$(basename "$ITEM_DIR")")"
NOTES="$ITEM_DIR/notes.md"
INTENT="$ROADMAP_DIR/intent.md"
INTENT_SLUG="$(slugify "$TITLE")"

if [ ! -f "$NOTES" ]; then
  {
    echo "# $TITLE Notes"
    echo
    echo "## Raw Intent"
    echo
    echo '```text'
    printf '%s\n' "$RAW_TEXT"
    echo '```'
    echo
    echo "## Clarified Concern"
    echo
    echo "Captured from user clarification on $TODAY."
    echo
    echo "## Notes"
    echo
    printf '%s\n' "$RAW_TEXT"
  } > "$NOTES"
else
  {
    echo
    echo "## $TODAY Clarification"
    echo
    echo '```text'
    printf '%s\n' "$RAW_TEXT"
    echo '```'
  } >> "$NOTES"
fi

{
  echo
  echo "## $TODAY - $TITLE Clarification"
  echo
  echo "Raw input:"
  echo
  echo '```text'
  printf '%s\n' "$RAW_TEXT"
  echo '```'
} >> "$INTENT"

update_frontmatter "$README"

scripts/roadmap/next-roadmap-actions.sh >/dev/null
scripts/roadmap/attention-summary.sh

echo "Captured clarification for item $ITEM_ID: $TITLE"
echo "Notes: docs/roadmap/$(basename "$ITEM_DIR")/notes.md"
echo "Intent entry: docs/roadmap/intent.md#$INTENT_SLUG-clarification"
