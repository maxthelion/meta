#!/usr/bin/env bash
# Summarise roadmap items that need user attention.
#
# Intended for end-of-response PM check-ins, not SessionStart. This keeps
# attention prompts near the conversation where they can be acted on.

set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

ROADMAP_DIR="$REPO/docs/roadmap"

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

attention_count=0
rows=""

while IFS= read -r dir; do
  readme="$dir/README.md"
  id="$(frontmatter_value "$readme" "id" "?")"
  title="$(frontmatter_value "$readme" "title" "$(basename "$dir")")"
  status="$(frontmatter_value "$readme" "status" "unknown")"
  blocked_by="$(frontmatter_value "$readme" "blocked_by" "[]")"
  question_file="$dir/open-questions.md"
  concerns_file="$dir/concerns.md"

  reason=""
  if [ -s "$question_file" ]; then
    reason="open questions"
  elif [ -s "$concerns_file" ]; then
    concern_status="$(frontmatter_value "$concerns_file" "status" "open")"
    case "$concern_status" in
      resolved|archived)
        reason=""
        ;;
      *)
        reason="open concerns"
        ;;
    esac
  elif [ "$status" = "blocked" ]; then
    reason="blocked"
  elif [ -n "$blocked_by" ] && [ "$blocked_by" != "[]" ]; then
    reason="blocked by $blocked_by"
  fi

  if [ -n "$reason" ]; then
    attention_count=$((attention_count + 1))
    rows="${rows}- ${id}. ${title} — ${reason} (\`docs/roadmap/$(basename "$dir")/\`)\n"
  fi
done < <(roadmap_dirs)

if [ "$attention_count" -eq 0 ]; then
  echo "Roadmap attention: no blocked items, open questions, or open concerns."
else
  echo "Roadmap attention: $attention_count item(s) need user input."
  printf '%b' "$rows"
fi
