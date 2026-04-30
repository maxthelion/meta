---
name: pm-next-action
description: Run one iteration of the roadmap PM behaviour tree. Refreshes docs/roadmap/next-actions.md, executes the Next Agent Item via the pm-assistant subagent, commits the result, and surfaces any user-attention items. Pair with /loop for an autonomous PM heartbeat. Exits cleanly when only user-input items remain.
---

# PM Next Action

## The split

This is the roadmap-PM counterpart of `/next-action`. Selector and executor are deliberately separated so only the expensive part uses an LLM:

1. **`scripts/roadmap/next-roadmap-actions.sh`** — pure bash. Reads each `docs/roadmap/<feature-slug>/` directory and the front matter in its `README.md`. Picks the first missing artifact per feature (`blocked → notes → user-stories → existing-state → prototypes/* → ux-review → spec → plan → ready`). Writes `docs/roadmap/next-actions.md`.

2. **This skill (`/pm-next-action`)** — LLM. Reads `next-actions.md`. Dispatches the `pm-assistant` subagent against the **Next Agent Item** if there is one. Commits via `commit-roadmap-action.sh`. Surfaces blocked items via `attention-summary.sh`. Exits.

Under `/loop`, the pattern is:

```
loop iteration:
  → next-roadmap-actions.sh writes docs/roadmap/next-actions.md
  → /pm-next-action reads it, dispatches pm-assistant if there is an agent item, commits, exits
next iteration:
  → next-roadmap-actions.sh re-evaluates against the new state
  → ...
```

Process reference: `docs/working-through-a-roadmap.md`. Sub-agent contract: `.claude/agents/pm-assistant.md`.

## How to invoke

- `/pm-next-action` — manual single iteration. Refreshes the selector first, then runs at most one PM action.
- `/loop 10m /pm-next-action` — continuous PM heartbeat, matching the cadence described in `docs/working-through-a-roadmap.md` § "Active Heartbeat Automation".

## What this skill does

1. **Refresh the selector.** Run `scripts/roadmap/next-roadmap-actions.sh`. This rewrites `docs/roadmap/next-actions.md` against current state.
2. **Read `docs/roadmap/next-actions.md`.** Locate the `## Next Agent Item` section and capture: item id, feature title, slug, action verb, reason, suggested output.
3. **Decide whether to act.**
   - If the section says "No roadmap items currently have an autonomous PM-assistant action" → run `scripts/roadmap/attention-summary.sh`, report what is blocking, exit. Do **not** commit.
   - Otherwise → continue to step 4.
4. **Dispatch `pm-assistant`.** Use the `Agent` tool with `subagent_type: pm-assistant`. The brief must be self-contained: include the feature slug, action verb, reason from the selector, and the suggested-output guidance verbatim. Tell the agent to follow its own action contract in `.claude/agents/pm-assistant.md` and to return the standard report format (`DONE` / `BLOCKED` / `DONE_WITH_CONCERNS` plus changed paths).
5. **Apply the result.**
   - If `pm-assistant` reports `DONE` and wrote files under `docs/roadmap/`, run `scripts/roadmap/commit-roadmap-action.sh`. The helper already filters pure `next-actions.md` churn so a no-op refresh does not produce a commit.
   - If `pm-assistant` reports `DONE_WITH_CONCERNS`, confirm it wrote or updated `concerns.md`, then run `scripts/roadmap/commit-roadmap-action.sh`. The next selector run will surface the item under "Next User Item" as `review-concerns`.
   - If `pm-assistant` reports `BLOCKED`, the agent will have written `open-questions.md` and updated front matter. The commit helper still applies; the next selector run will surface the item under "Next User Item".
6. **Refresh and surface attention.** Rerun `scripts/roadmap/next-roadmap-actions.sh` so the post-action state is reflected. Then run `scripts/roadmap/attention-summary.sh` and include its output in the final response.
7. **Exit.** Do not chain into a second action. The next loop iteration evaluates from scratch.

## Action verbs (handled by `pm-assistant`)

The selector emits one of these verbs. Definitions and per-action contracts live in `.claude/agents/pm-assistant.md`; this list is here as a sanity check, not as the canonical roster.

| Verb | Artifact written | Loop role |
|---|---|---|
| `clarify-feature` | (none — needs user) | **Skipped by this skill.** Surfaces via attention summary. |
| `address-feedback` | affected roadmap artifact plus handled `feedback/*.md` front matter | `pm-assistant` |
| `draft-user-stories` | `user-stories.md` or `open-questions.md` | `pm-assistant` |
| `inspect-existing-state` | `existing-state.md` | `pm-assistant` |
| `build-prototypes` | `prototypes/*` | `pm-assistant` (HTML wireframes only) |
| `write-architecture` | `architecture.md` | `pm-assistant` |
| `write-implementation-handoff` | `implementation-handoff.md` | `pm-assistant` |
| `write-spec` | `spec.md` | `pm-assistant` |
| `write-plan` | `plan.md` | `pm-assistant` |
| `review-prototypes` | `ux-review.md` | `pm-assistant` |
| `review-architecture` | `architecture-review.md` | `pm-assistant` |
| `review-concerns` | (none — needs user review first) | **Skipped by this skill.** User decides whether concerns become guardrails, questions, or resolved notes. |
| `ready-for-build-queue` | (none — promotion is a user decision) | **Skipped by this skill.** Use `scripts/roadmap/promote-ready-item-to-worktree.sh <item-id>` when the user explicitly promotes it. |
| `blocked` | (none) | **Skipped by this skill.** |

If the selector emits a verb that is not `pm-assistant`'s (`clarify-feature`, `blocked`, `review-concerns`, `ready-for-build-queue`), this skill exits without dispatching. Those need a human.

## Loop boundary — do not cross

This skill is the PM loop. It must not become an implementation loop.

- **Edits only `docs/roadmap/**`.** The `pm-assistant` agent is already write-scoped to that directory; do not relax that.
- **No production code, tests, wiki, or `docs/specs/` / `docs/plans/` writes.** Promotion to the build queue is an explicit user-driven step handled outside this skill by `scripts/roadmap/promote-ready-item-to-worktree.sh`.
- **No `.claude/state/` writes.** That namespace belongs to the implementation BT (`/next-action`). The two trees share no state files.
- **Commits stay under `docs/roadmap/`.** Use `scripts/roadmap/commit-roadmap-action.sh` — it stages `docs/roadmap/**` only and skips empty refresh-only changes.

## Safety rails

- **One action per invocation.** No chaining. The next selector run picks the next item.
- **No-churn under /loop.** If there is no Next Agent Item, exit before dispatching anything. The selector refresh + attention summary are cheap and idempotent; nothing else runs.
- **No human interaction in the loop.** If `pm-assistant` returns `BLOCKED`, that is the expected handoff to the user — the open-questions file plus the next attention summary are the user's notification. Exit cleanly.
- **Stop on uncertainty.** If `next-actions.md` cannot be parsed or `pm-assistant` returns an unexpected status, exit with a short report. Do not improvise past the agent's contract.

## Final report format

End the response with two short blocks:

```
PM action: <verb> on item <id> <title> — <DONE|BLOCKED|DONE_WITH_CONCERNS|skipped>
<one-line description of what was written or why nothing ran>

<output of scripts/roadmap/attention-summary.sh>
```

Keep it tight. The diff is the source of truth; this skill should not produce a wall of summary text.

## Related

- `scripts/roadmap/next-roadmap-actions.sh` — the selector (bash; pure function of `docs/roadmap/` state)
- `scripts/roadmap/attention-summary.sh` — end-of-response check-in for blocked items
- `scripts/roadmap/commit-roadmap-action.sh` — commits `docs/roadmap/**` only
- `.claude/agents/pm-assistant.md` — the only sub-agent this skill dispatches
- `docs/working-through-a-roadmap.md` — process reference
- `/next-action` — the implementation-loop counterpart (different state, different agents)
