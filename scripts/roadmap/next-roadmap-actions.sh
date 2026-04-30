#!/usr/bin/env bash
# Experimental deterministic roadmap selector.
#
# This is the project-management counterpart to the implementation behaviour
# tree. It does not dispatch agents and it does not build anything. It reads
# docs/roadmap/<feature>/ and reports the likely next planning action for each
# feature area from the artifacts already present.

set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO"

ROADMAP_DIR="$REPO/docs/roadmap"
OUT="$ROADMAP_DIR/next-actions.md"

if [ ! -d "$ROADMAP_DIR" ]; then
  echo "Missing roadmap directory: $ROADMAP_DIR" >&2
  exit 1
fi

has_content_file() {
  local file="$1"
  [ -s "$file" ]
}

has_prototype() {
  local dir="$1"
  [ -d "$dir/prototypes" ] || return 1
  find "$dir/prototypes" -maxdepth 1 -type f \( -name '*.html' -o -name '*.md' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) | grep -q .
}

has_unhandled_feedback() {
  local dir="$1"
  local feedback_dir="$dir/feedback"
  [ -d "$feedback_dir" ] || return 1

  while IFS= read -r file; do
    local status
    status="$(frontmatter_value "$file" "status" "new")"
    case "$status" in
      handled|archived)
        ;;
      *)
        return 0
        ;;
    esac
  done < <(find "$feedback_dir" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' | sort)

  return 1
}

has_open_concerns() {
  local file="$1/concerns.md"
  [ -s "$file" ] || return 1

  local status
  status="$(frontmatter_value "$file" "status" "open")"
  case "$status" in
    resolved|archived)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

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

feature_meta() {
  local dir="$1"
  local key="$2"
  local fallback="${3:-}"
  frontmatter_value "$dir/README.md" "$key" "$fallback"
}

read_title() {
  local dir="$1"
  local readme="$dir/README.md"
  local title
  title="$(feature_meta "$dir" "title" "")"
  if [ -n "$title" ]; then
    printf '%s\n' "$title"
  elif [ -f "$readme" ]; then
    sed -n 's/^# //p' "$readme" | head -1
  else
    basename "$dir"
  fi
}

roadmap_dirs() {
  # Backlog order lives in docs/roadmap/README.md. Fall back to the working
  # roadmap doc's inventory, then lexicographic directory order.
  local index="$ROADMAP_DIR/README.md"
  local inventory="$REPO/docs/working-through-a-roadmap.md"
  local listed=""

  if [ -f "$index" ]; then
    listed="$(sed -n 's/^- \(**[0-9][0-9]*\*\* \)\{0,1\}\[[^]]*\](\([^)]*\/\))$/\2/p' "$index" | while IFS= read -r rel; do
      rel="${rel%/}"
      if [ -d "$ROADMAP_DIR/$rel" ]; then
        printf '%s\n' "$ROADMAP_DIR/$rel"
      fi
    done)"
  fi

  if [ -z "$listed" ] && [ -f "$inventory" ]; then
    listed="$(sed -n 's/^- \*\*Feature area:\*\* //p' "$inventory" | while IFS= read -r title; do
      slug="$(printf '%s\n' "$title" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/&/and/g; s/[^a-z0-9]/-/g; s/-\{1,\}/-/g; s/^-//; s/-$//')"
      if [ -d "$ROADMAP_DIR/$slug" ]; then
        printf '%s\n' "$ROADMAP_DIR/$slug"
      fi
    done)"
  fi

  {
    printf '%s\n' "$listed"
    find "$ROADMAP_DIR" -mindepth 1 -maxdepth 1 -type d | sort
  } | awk 'NF && !seen[$0]++'
}

review_verdict_redirect() {
  # If a review document carries `verdict: needs-rework` or `verdict: rejected`,
  # echo the `redirect_to` target (or the supplied default) and return 0.
  # Verdicts other than needs-rework/rejected (accepted, empty, missing) leave
  # the selector free to advance on file-presence as before.
  local file="$1"
  local default_redirect="$2"
  if [ ! -s "$file" ]; then
    return 1
  fi
  local verdict
  verdict="$(frontmatter_value "$file" "verdict" "")"
  case "$verdict" in
    needs-rework|rejected)
      local redirect_to
      redirect_to="$(frontmatter_value "$file" "redirect_to" "$default_redirect")"
      if [ -z "$redirect_to" ]; then
        redirect_to="$default_redirect"
      fi
      printf '%s\n' "$redirect_to"
      return 0
      ;;
  esac
  return 1
}

classify_feature() {
  local dir="$1"
  local next_action=""
  local reason=""
  local output_hint=""
  local status
  local blocked_by

  status="$(feature_meta "$dir" "status" "unknown")"
  blocked_by="$(feature_meta "$dir" "blocked_by" "[]")"

  if [ "$status" = "deferred" ]; then
    next_action="deferred"
    reason="Status is \`deferred\`; this item is intentionally skipped for now."
    output_hint="No action until the user reactivates this item."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi

  if has_unhandled_feedback "$dir"; then
    next_action="address-feedback"
    reason="Unresolved feedback exists in \`feedback/*.md\`."
    output_hint="Read new feedback, update the affected roadmap artifact, then mark the feedback handled with links to changed files."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi

  if has_open_concerns "$dir"; then
    next_action="review-concerns"
    reason="\`concerns.md\` exists and is not resolved or archived."
    output_hint="Review the concerns, decide whether they are accepted guardrails, open questions, or non-blocking notes, then update \`concerns.md\` before PM work continues."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi

  if [ "$status" = "blocked" ] || { [ -n "$blocked_by" ] && [ "$blocked_by" != "[]" ]; } || has_content_file "$dir/open-questions.md"; then
    next_action="blocked"
    reason="Status is \`$status\`, blocked_by is \`$blocked_by\`, or \`open-questions.md\` exists."
    output_hint="Answer the open questions or resolve the blocker before advancing this item."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi

  # Review-document verdicts: if a review explicitly says "go back", route to
  # the redirect target instead of advancing on file presence alone.
  local redirect
  if redirect="$(review_verdict_redirect "$dir/ux-review.md" "build-prototypes")"; then
    next_action="$redirect"
    reason="\`ux-review.md\` verdict is \`needs-rework\` or \`rejected\`; redirect_to=\`$redirect\`."
    output_hint="Address the verdict in \`ux-review.md\`. The existing review stays as input; produce a fresh artifact at the redirect target."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi
  if redirect="$(review_verdict_redirect "$dir/architecture-review.md" "write-architecture")"; then
    next_action="$redirect"
    reason="\`architecture-review.md\` verdict is \`needs-rework\` or \`rejected\`; redirect_to=\`$redirect\`."
    output_hint="Address the verdict in \`architecture-review.md\`. The existing review stays as input; produce a fresh artifact at the redirect target."
    printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
    return
  fi

  if ! has_content_file "$dir/notes.md"; then
    next_action="clarify-feature"
    reason="No \`notes.md\` yet."
    output_hint="Capture the brief user clarification: what feels wrong, what users are trying to achieve, what the model already gets right, and any constraints."
  elif ! has_content_file "$dir/user-stories.md"; then
    next_action="draft-user-stories"
    reason="\`notes.md\` exists, but \`user-stories.md\` is missing."
    output_hint="Run a background PM pass. Write \`user-stories.md\`, or create \`open-questions.md\` and mark the feature blocked if the notes are too thin."
  elif ! has_content_file "$dir/existing-state.md"; then
    next_action="inspect-existing-state"
    reason="User stories exist, but \`existing-state.md\` is missing."
    output_hint="Inspect code, docs, tests, screenshots, and prototypes; report model/UI gaps with file references."
  elif ! has_prototype "$dir"; then
    next_action="build-prototypes"
    reason="Existing-state report exists, but no prototype artifact was found in \`prototypes/\`."
    output_hint="Create focused Balsamiq-style HTML prototypes under this feature directory."
  elif ! has_content_file "$dir/ux-review.md"; then
    next_action="review-prototypes"
    reason="Prototype artifacts exist, but \`ux-review.md\` is missing."
    output_hint="Review variants against the UX checklist and choose or reject a direction."
  elif ! has_content_file "$dir/architecture.md"; then
    next_action="write-architecture"
    reason="UX review exists, but \`architecture.md\` is missing."
    output_hint="Write architecture guardrails before the feature spec: invariants, lightweight data/runtime shape, persistence boundaries, and risks."
  elif ! has_content_file "$dir/architecture-review.md"; then
    next_action="review-architecture"
    reason="Architecture guardrails exist, but \`architecture-review.md\` is missing."
    output_hint="Review the architecture summary before spec: data/runtime shape, transient versus persisted state, guardrails, and open questions."
  elif ! has_content_file "$dir/spec.md"; then
    next_action="write-spec"
    reason="Architecture review exists, but \`spec.md\` is missing."
    output_hint="Write the feature specification from the selected prototype direction and reviewed architecture guardrails."
  elif ! has_content_file "$dir/plan.md"; then
    next_action="write-plan"
    reason="Spec exists, but \`plan.md\` is missing."
    output_hint="Write the implementation plan without starting production work."
  elif ! has_content_file "$dir/implementation-handoff.md"; then
    next_action="write-implementation-handoff"
    reason="Plan exists, but \`implementation-handoff.md\` is missing."
    output_hint="Bundle the PM artifacts into a build-loop handoff that links authoritative context, guardrails, spec, plan, non-goals, and open questions."
  else
    next_action="ready-for-build-queue"
    reason="Planning artifacts are present."
    output_hint="Promote the implementation handoff into the normal build queue when the user chooses."
  fi

  printf '%s\t%s\t%s\n' "$next_action" "$reason" "$output_hint"
}

action_agent() {
  local action="$1"

  case "$action" in
    clarify-feature|blocked|review-concerns)
      printf '%s\n' "user"
      ;;
    deferred)
      printf '%s\n' "pm"
      ;;
    ready-for-build-queue)
      printf '%s\n' "pm"
      ;;
    *)
      printf '%s\n' "pm-assistant"
      ;;
  esac
}

tmp="$OUT.tmp.$$"
{
  echo "# Roadmap Next Actions"
  echo
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Repo HEAD: $(git rev-parse --short HEAD)"
  echo "Branch:    $(git rev-parse --abbrev-ref HEAD)"
  echo
  echo "This is an experimental deterministic project-management scan. It does not build anything; it only infers the likely next planning action from files under \`docs/roadmap/<feature-slug>/\`."
  echo
  echo "Each roadmap item has front matter in its feature \`README.md\`: \`id\`, \`title\`, \`status\`, \`priority\`, \`blocked_by\`, \`stage\`, \`owner\`, and \`updated\`."
  echo
  echo "Planning actions after \`clarify-feature\` are intended for the \`pm-assistant\` role, except \`review-concerns\`, which requires user judgment. \`clarify-feature\`, \`blocked\`, and \`review-concerns\` require user input. \`review-prototypes\`, \`review-architecture\`, and \`address-feedback\` are PM-assistant actions."
  echo
  echo "## Selector"
  echo
  echo "For each feature, deferred status wins first, then unresolved feedback, then open concerns, then blocked metadata or open questions, then review-document verdicts requesting rework; otherwise the first missing artifact wins:"
  echo
  echo "1. \`status: deferred\` -> deferred"
  echo "2. unresolved \`feedback/*.md\` -> address-feedback"
  echo "3. open \`concerns.md\` -> review-concerns"
  echo "4. \`status: blocked\`, non-empty \`blocked_by\`, or \`open-questions.md\` -> blocked"
  echo "5. \`ux-review.md\` with \`verdict: needs-rework\`/\`rejected\` -> \`redirect_to\` (default \`build-prototypes\`)"
  echo "6. \`architecture-review.md\` with \`verdict: needs-rework\`/\`rejected\` -> \`redirect_to\` (default \`write-architecture\`)"
  echo "7. \`notes.md\` -> clarify-feature"
  echo "8. \`user-stories.md\` -> draft-user-stories"
  echo "9. \`existing-state.md\` -> inspect-existing-state"
  echo "10. \`prototypes/*\` -> build-prototypes"
  echo "11. \`ux-review.md\` -> review-prototypes"
  echo "12. \`architecture.md\` -> write-architecture"
  echo "13. \`architecture-review.md\` -> review-architecture"
  echo "14. \`spec.md\` -> write-spec"
  echo "15. \`plan.md\` -> write-plan"
  echo "16. \`implementation-handoff.md\` -> write-implementation-handoff"
  echo "17. all present -> ready-for-build-queue"
  echo
  echo "## Next User Item"
  echo

  user_written=0
  agent_written=0
  rows_file="$OUT.rows.$$"
  : > "$rows_file"

  while IFS= read -r dir; do
    title="$(read_title "$dir")"
    slug="$(basename "$dir")"
    id="$(feature_meta "$dir" "id" "?")"
    status="$(feature_meta "$dir" "status" "unknown")"
    priority="$(feature_meta "$dir" "priority" "unset")"
    blocked_by="$(feature_meta "$dir" "blocked_by" "[]")"
    IFS=$'\t' read -r action reason hint < <(classify_feature "$dir")
    agent="$(action_agent "$action")"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$action" "$agent" "$id" "$title" "$slug" "$status" "$priority" "$blocked_by" "$reason" "$hint" >> "$rows_file"
  done < <(roadmap_dirs)

  while IFS=$'\t' read -r action agent id title slug status priority blocked_by reason hint; do
    if [ "$user_written" -eq 0 ] && [ "$agent" = "user" ]; then
      echo "- **Item:** $id"
      echo "- **Feature:** $title"
      echo "- **Priority:** \`$priority\`"
      echo "- **Status:** \`$status\`"
      echo "- **Action:** \`$action\`"
      echo "- **Role:** \`$agent\`"
      echo "- **Why:** $reason"
      echo "- **Output:** $hint"
      user_written=1
    fi
  done < "$rows_file"

  if [ "$user_written" -eq 0 ]; then
    echo "- No roadmap items currently require user input."
  fi

  echo
  echo "## Next Agent Item"
  echo

  while IFS=$'\t' read -r action agent id title slug status priority blocked_by reason hint; do
    if [ "$agent_written" -eq 0 ] && [ "$agent" = "pm-assistant" ]; then
      echo "- **Item:** $id"
      echo "- **Feature:** $title"
      echo "- **Priority:** \`$priority\`"
      echo "- **Status:** \`$status\`"
      echo "- **Action:** \`$action\`"
      echo "- **Role:** \`$agent\`"
      echo "- **Why:** $reason"
      echo "- **Output:** $hint"
      agent_written=1
    fi
  done < "$rows_file"

  if [ "$agent_written" -eq 0 ]; then
    echo "- No roadmap items currently have an autonomous PM-assistant action."
  fi

  echo
  echo "## Feature Actions"
  echo

  while IFS=$'\t' read -r action agent id title slug status priority blocked_by reason hint; do
    echo "### $id. $title"
    echo
    echo "- **Directory:** \`docs/roadmap/$slug/\`"
    echo "- **Status:** \`$status\`"
    echo "- **Priority:** \`$priority\`"
    echo "- **Blocked by:** \`$blocked_by\`"
    echo "- **Next action:** \`$action\`"
    echo "- **Role:** \`$agent\`"
    echo "- **Reason:** $reason"
    echo "- **Suggested output:** $hint"
    echo
  done < "$rows_file"

  rm -f "$rows_file"
} > "$tmp"

mv -f "$tmp" "$OUT"
echo "Wrote $OUT"
