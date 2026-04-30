# Working Through A Roadmap

This document is the working process for shaping roadmap areas where the underlying model may already be sound, but the user experience is not yet good enough.

The goal is to move each feature area from "we know something is wrong" to a clear, reviewed, prototyped, and buildable specification without losing the design context along the way.

## Roadmap Inventory

Add every feature area under this section before deep-diving any one item. Keep the first pass short: the list should name the areas, not solve them.

Template:

```markdown
- **Item:** <integer id>
  - **Feature area:** <short name>
  - **Current concern:** <what feels wrong or unfinished>
  - **Known model status:** <correct / partly correct / unknown>
  - **Roadmap directory:** `docs/roadmap/<feature-slug>/`
  - **Notes:** <links, screenshots, examples, or constraints>
```

Feature areas to work through:

The canonical ordered list is `docs/roadmap/README.md`. Each item has a stable integer ID and metadata front matter in its feature `README.md`. Raw user input is preserved in `docs/roadmap/intent.md` before it is normalized into roadmap artifacts.

## Per-Feature Workflow

Use this workflow for each feature area in the inventory.

### Feature Directory

Keep all artifacts for a roadmap item together under `docs/roadmap/<feature-slug>/`.

Suggested layout:

```text
docs/roadmap/<feature-slug>/
  README.md
  artifacts.md
  feedback/
  concerns.md
  notes.md
  open-questions.md
  user-stories.md
  existing-state.md
  prototypes/
  ux-review.md
  architecture.md
  architecture-review.md
  spec.md
  plan.md
  implementation-handoff.md
```

`README.md` is the feature's lightweight index. Use the other files as the feature matures; do not create empty documents before they have useful content.

Each feature `README.md` should start with front matter:

```yaml
---
id: 1
title: Clip History
status: inventory
priority: unset
blocked_by: []
stage: clarify-feature
owner: pm
updated: 2026-04-29
---
```

Use integer IDs when discussing, blocking, or prioritising items. `blocked_by` should refer to item IDs, for example `[4, 5]`.

### Feedback Queue

Each feature directory should contain a `feedback/` directory. This is the inbox for user review comments, prototype concerns, architecture notes, and other feature-specific corrections that should be addressed by the PM assistant before the item advances.

Use the deterministic helper when capturing feedback:

```bash
scripts/roadmap/capture-feedback.sh <item-id> <applies-to> "<raw feedback>"
```

`<applies-to>` should name the artifact or stage being reviewed, for example `prototypes`, `architecture`, `spec`, `plan`, or `general`.

The helper writes a timestamped file:

```text
docs/roadmap/<feature-slug>/feedback/<timestamp>-<scope>-feedback.md
```

Feedback files use front matter:

```yaml
---
status: new
applies_to: prototypes
created: 2026-04-30T09:00:00Z
handled_by: null
handled_in: []
---
```

The PM assistant should treat any feedback file whose `status` is not `handled` or `archived` as unresolved. It should read the feedback, update the affected roadmap artifact, and then update the feedback front matter:

```yaml
status: handled
handled_by: pm-assistant
handled_in:
  - docs/roadmap/<feature-slug>/ux-review.md
```

If the feedback cannot be applied without more user judgment, the PM assistant should create or update `open-questions.md`, mark the feature blocked, and then mark the feedback handled with `handled_in` pointing to the open questions. The point is not to make the PM assistant guess; it is to keep review comments auditable and routable.

### Concerns

When a PM-assistant action returns `DONE_WITH_CONCERNS`, the concern must be durable, not only text in the loop report. The agent should write or update:

```text
docs/roadmap/<feature-slug>/concerns.md
```

Use front matter:

```yaml
---
status: open
raised_by: pm-assistant
raised_during: draft-user-stories
created: 2026-04-30T09:00:00Z
resolved_in: []
---
```

Open concerns are different from open questions:

- Use `open-questions.md` and `status: blocked` when user input is required before any useful PM work can continue.
- Use `concerns.md` when the artifact can be written, but a risk, unresolved implementation choice, or architecture boundary needs review before the item advances further.

The selector treats `concerns.md` with any status other than `resolved` or `archived` as `review-concerns` in the user lane. This prevents the PM loop from silently rolling forward after `DONE_WITH_CONCERNS`.

To clear the gate, update the front matter to:

```yaml
status: resolved
resolved_in:
  - docs/roadmap/<feature-slug>/architecture.md
```

or convert the concern into `open-questions.md` and mark the feature blocked.

### Review Verdicts

Review documents (`ux-review.md`, `architecture-review.md`) carry a verdict in
their frontmatter so the deterministic selector knows whether to advance or
route back to an earlier stage:

```yaml
---
verdict: accepted | needs-rework | rejected
redirect_to: build-prototypes        # only when needs-rework or rejected
selected_prototype: <filename>        # only on ux-review.md when accepted
---
```

How the selector reads it:

- `accepted` (or no `verdict` field, for back-compat) → advance to the next
  stage as if the review were simply present.
- `needs-rework` → route back to `redirect_to` (defaults: `build-prototypes`
  for `ux-review.md`, `write-architecture` for `architecture-review.md`).
- `rejected` → same as `needs-rework`. The PM-assistant should also consider
  whether to write `open-questions.md` rather than producing another round
  in the same shape.

The existing review document stays on disk as input for the next round —
the rework agent reads it to know what was wrong. Do not delete previous
reviews; the conversation about a feature is part of the feature directory.

If the user wants to redirect *after* a review has been accepted (e.g. they
read the spec next week and realise the prototype was wrong), they should
use `scripts/roadmap/capture-feedback.sh` instead of editing the verdict.
The selector's "unresolved feedback wins first" rule then routes the next
agent pass through `address-feedback`.

### Status Values

Use these `status` values consistently in feature `README.md` front matter:

- `inventory`: the item is active in the roadmap workflow and should advance through the next missing artifact.
- `blocked`: the item needs user input or another dependency before PM work can continue. Use with `open-questions.md` for user questions, or `blocked_by: [<item-id>]` for roadmap dependencies.
- `deferred`: the item is intentionally skipped for now. The deterministic selector should report it as deferred in the feature list but should not put it in the user lane or PM-assistant lane.
- `ready-for-build`: the PM artifacts are complete enough for the separate implementation loop.

When deferring an item:

- set `status: deferred`;
- set `stage: deferred`;
- keep existing notes/artifacts intact;
- add a short raw-intent entry explaining why it was deferred;
- reactivate it later by restoring `status: inventory` and the appropriate `stage`.

### Implementation Artifact Bundle

The PM process should accumulate artifacts that can be handed to the implementation loop without requiring the implementer to reconstruct product context from chat history.

The important PM artifacts are:

- `notes.md` and `intent.md` entries for raw user language.
- `feedback/*.md` for review comments and corrections that need to be incorporated before the item advances.
- `concerns.md` for durable `DONE_WITH_CONCERNS` output that needs review before the item advances.
- `user-stories.md` for goals and acceptance signals.
- `existing-state.md` for current model/UI/test reality.
- `prototypes/` and `ux-review.md` for selected UX direction.
- `architecture.md` for guardrails and invariants, grounded in code plus wiki/project guidelines.
- `architecture-review.md` for an adversarial review of those guardrails before spec.
- `spec.md` for the buildable product contract.
- `plan.md` for execution sequence.
- `implementation-handoff.md` as the final index and ingestion packet for the build loop.

The implementation loop should consume the handoff first, then follow links to deeper artifacts as needed.

### Intent Log

Keep a raw intent log at `docs/roadmap/intent.md`.

Use it to preserve the user's original words before translating them into:

- roadmap item names and IDs
- metadata front matter
- feature notes
- user stories
- prototype instructions
- specs or plans

Append new dated entries as the roadmap discussion continues. Do not rewrite older raw input except to fix obvious transcription mistakes.

### 1. Clarify The Feature Problem

Start by asking the user to briefly clarify what needs to be addressed for this feature.

Ask for:

- What feels broken or awkward in the current UX.
- What users are trying to achieve.
- What the underlying model already gets right.
- Any examples, screenshots, references, or "definitely not this" constraints.

Keep this stage lightweight. The purpose is to focus the investigation, not to write the specification yet.

Use the deterministic helper when capturing a clarification:

```bash
scripts/roadmap/capture-clarification.sh <item-id> "<raw clarification>"
```

The helper appends the raw input to `docs/roadmap/intent.md`, creates or appends a raw feature `notes.md`, updates the feature front matter, and refreshes the roadmap queues. It should stay deliberately mechanical; story/spec shaping belongs to the PM assistant.

Do not use the helper when the user's intention is too vague, contradictory, or strategically ambiguous for a PM assistant to work from. In that case, keep the work in conversation and ask clarifying questions instead of turning uncertainty into a roadmap artifact.

### 2. Write User Stories

Turn the clarification into user stories that describe goals rather than implementation.

Each story should capture:

- The user role or context.
- The goal they want to achieve.
- The reason it matters in a music-making flow.
- The observable outcome that would make the story feel complete.

Prefer stories that describe real work: creating a track, routing sound, editing a phrase, performing live, recovering from a mistake, understanding what will happen at playback, and so on.

#### Background User Story Pass

This step is safe for a background agent when `notes.md` exists.

The agent should read only the feature directory plus directly linked docs. It should then do one of two things:

- Write `user-stories.md` with a first-pass set of goal-oriented stories and acceptance signals.
- Write `open-questions.md` and mark the feature as blocked if there is not enough information to infer useful stories.

Blocking on open questions means:

- Create `open-questions.md` with concise questions for the user.
- Update the feature `README.md` front matter to `status: blocked` and set `stage: clarify-feature`.
- Keep `blocked_by: []` unless the blocker is another roadmap item; user questions are represented by `status: blocked` plus `open-questions.md`.

The background pass should not inspect the production implementation yet. If it needs code context to know what stories are possible, that is a sign to ask an open question rather than crossing into the existing-state phase.

### 3. Inspect What Exists

Look at the current code, docs, prototypes, and screenshots for the feature.

Report back with:

- What already exists in the model, engine, persistence, and UI.
- Where the current UX diverges from the user stories.
- Which gaps are model gaps versus presentation or workflow gaps.
- Any architecture constraints that should shape the design.
- Any existing tests or missing test coverage that matter.

This report should be factual and grounded in file references where useful. Do not jump straight to implementation.

### 4. Build Prototypes

Build a small set of prototypes before committing to the production design.

Prototype guidance:

- Prefer fast, inspectable artifacts in the feature directory's `prototypes/` folder unless an in-app prototype is clearly necessary.
- Build multiple alternatives when the interaction model is uncertain.
- Keep prototypes focused on the workflow and information hierarchy.
- Do not polish visual decoration before the flow is understood.
- Include enough realistic labels, states, and data density to judge the experience honestly.

The user will provide feature-specific instructions for the prototype phase. HTML prototypes should follow `docs/html-prototype-guidelines.md`.

### 5. Review Prototype UX

Prototype review is a PM-assistant behaviour. The selector should surface `review-prototypes` in the agent lane whenever prototype artifacts exist and `ux-review.md` is missing.

The PM assistant should inspect the prototypes against the user stories and give product feedback: what feels promising, what fails, what direction to keep, and what needs another pass. The review should be adversarial enough to try the stated goals rather than only describing the screens. If the user later disagrees with the review, capture that correction with `scripts/roadmap/capture-feedback.sh <item-id> prototypes "<raw feedback>"`. The next PM-assistant pass will route to `address-feedback`, revise `ux-review.md`, and mark the feedback handled.

Evaluate each prototype against a UX checklist before choosing a direction.

Checklist:

- **Goal clarity:** The main user goal is visible without explanation.
- **Progressive disclosure:** Advanced options appear when useful, not all at once.
- **Information hierarchy:** Primary state, secondary metadata, and controls have clear visual priority.
- **No repeated information:** The same concept is not restated in multiple places unless the repetition serves a workflow.
- **Flow grouping:** Interactions that belong to the same part of the task are grouped together.
- **State legibility:** The user can tell what is selected, armed, playing, routed, muted, edited, or pending.
- **Action locality:** Controls appear near the thing they affect.
- **Reversibility:** Destructive or high-impact actions are either undoable, previewable, or confirmed.
- **Empty and error states:** The design handles missing data, unavailable devices, no samples, failed scans, and incompatible selections.
- **Performance feel:** The flow avoids unnecessary modal stops, repeated clicks, and hidden waits during live music work.
- **Keyboard and pointer ergonomics:** Frequent actions are reachable without precise hunting.
- **Consistency:** Naming, layout, and control types match nearby parts of the app.

Record the review outcome:

- What works.
- What fails.
- Which prototype direction to keep.
- Which details need another pass.

### 6. Write Architecture Guardrails

Before writing a build spec, pause to describe how the proposed feature should fit the application architecture.

This is not an implementation plan. It is a guardrail document that prevents plausible UX ideas from turning into expensive rewrites or model shapes that fight the sequencer.

Write `architecture.md` with:

- The important application invariants the feature must preserve.
- The lightweight data shape or runtime state model that should support the UX.
- Small Mermaid diagrams that highlight any proposed data model changes, pipeline/data-flow changes, and component responsibility boundaries.
- What should remain transient versus what should be persisted in the document.
- How the feature should avoid broad document rewrites, duplicated code paths, or UI-only state becoming playback truth.
- Any existing local patterns to follow, such as array-buffer style sequencer data structures, runtime snapshots, or small focused document deltas.
- Concrete architecture questions that must be answered before spec.

The diagrams should be explanatory, not decorative. Use them to show what is
new, what changes, and what stays as-is so the user can parse the recommendation
quickly before reading the detailed guardrails.

The architecture pass must inspect the relevant production code and project guidelines before recommending a course of action. Start with:

- `wiki/pages/project-layout.md`
- `wiki/pages/document-model.md`
- `wiki/pages/engine-architecture.md`
- `wiki/pages/architecture-guardrails.md`
- `wiki/pages/code-review-checklist.md`
- any feature-specific wiki pages, specs, plans, source files, and tests linked from `existing-state.md`

Examples:

- Clip History should decide how recent step history is stored cheaply, how a scrubbed history region becomes a pseudo clip, and exactly when that pseudo clip becomes a real persisted clip.
- Step-sequencer features should fit the existing array-buffer style data structures instead of introducing unrelated document storage.
- Large UX changes should identify the smallest document/runtime boundary they need rather than rewriting the project model around a view.

Architecture guardrails are reviewable before spec. The selector should surface `review-architecture` in the agent lane whenever `architecture.md` exists and `architecture-review.md` is missing.

The PM assistant should review:

- the proposed data/runtime shape;
- what is transient versus persisted;
- any guardrails that constrain the product direction;
- unresolved architecture questions.

The review should read like a recommendation to the user: what to accept, what to revise, what risks remain, and whether the feature may advance to spec. If the user later disagrees with the recommendation, capture that correction with `scripts/roadmap/capture-feedback.sh <item-id> architecture "<raw feedback>"`. The next PM-assistant pass will route to `address-feedback`, revise `architecture-review.md`, and mark the feedback handled. Do not write the spec until this review exists.

### 7. Specify The Feature

Once a prototype direction is chosen, write the build specification.

The spec should include:

- User stories and acceptance criteria.
- The chosen UX flow.
- Model, engine, persistence, and UI changes.
- Migration or compatibility notes.
- Testing requirements.
- Non-goals and deferred follow-ups.
- Risks and open questions.

Place the working spec and implementation plan in the feature directory. When a feature is ready for the main build queue, copy or promote stable versions into `docs/specs/` and `docs/plans/` if the broader automation flow needs them there.

### 8. Promote To Build Loop

After the spec is agreed, promote the feature to the separate implementation loop. Roadmap PM work and product-building work should remain different loops with different permissions and different worktrees.

Promotion means:

- The feature has a coherent `spec.md`.
- The feature has a buildable `plan.md` or is ready to be copied into the existing `docs/specs/` / `docs/plans/` automation flow.
- The feature has an `implementation-handoff.md` that indexes the PM artifacts and states what the build loop should consume.
- Open questions are resolved or explicitly deferred.
- Acceptance criteria and non-goals are clear enough for an implementation worker to execute without re-litigating the product direction.
- The feature `README.md` front matter can move to `status: ready-for-build`.

Use the deterministic promotion helper:

```bash
scripts/roadmap/promote-ready-item-to-worktree.sh <item-id>
```

The helper creates a dedicated implementation worktree under `.worktrees/`, creates an `auto/roadmap-<id>-<slug>` branch, and writes a normalized `docs/plans/*roadmap-*.md` build plan inside that worktree. It does not build production code.

After promotion, start the implementation loop from the printed worktree:

```bash
cd .worktrees/roadmap-<id>-<slug>
.claude/hooks/setup-next-action.sh
/loop /next-action
```

The original implementation behaviour tree has a special worktree-only bridge: promoted `docs/plans/*roadmap-*.md` plans outrank the generic candidates backlog, so agents keep advancing the promoted feature in slices. The normal implementation gates still apply: tests, inbox, review queue, partial work, adversarial review, work items, and commits remain owned by the implementation loop.

Do not run implementation agents from the PM worktree. Do not let the PM loop write `.claude/state/`, `docs/specs/`, `docs/plans/`, production code, tests, or wiki pages.

## Parallel Work

Workers can help while the main roadmap discussion continues, but only on bounded steps that do not require the next user decision.

### PM Assistant Role

Use the `pm-assistant` role for roadmap behaviour-tree work.

The role lives at `.claude/agents/pm-assistant.md`. It may edit `docs/roadmap/**` only, and it must not build production code. If the agent is not registered in the current session, dispatch a general-purpose Sonnet agent with the contents of `.claude/agents/pm-assistant.md` as the preamble.

### Two Separate Loops

There are two kinds of elves:

- **Roadmap / PM elves:** operate on `docs/roadmap/**`; clarify intent, draft stories, inspect existing state, review prototypes, write specs/plans, and surface questions. They do not build product code.
- **Implementation elves:** operate on the normal build loop after work is specced out; they may edit production code, tests, wiki, and state only according to the existing implementation permissions and review gates.

Do not let the PM loop quietly become an implementation loop. When a roadmap item is ready to build, promote it through an explicit handoff instead.

Good parallel tasks:

- Inspect the existing implementation for a named feature area.
- Gather relevant docs, screenshots, and tests.
- Build an isolated prototype from already-agreed instructions.
- Review a completed prototype against the UX checklist.
- Draft acceptance criteria from approved user stories.
- Draft first-pass user stories from `notes.md`, or write `open-questions.md` and mark the item blocked.

Avoid parallelizing:

- The initial clarification conversation.
- Choosing between unresolved UX directions.
- Production implementation before the spec is agreed.
- Broad rewrites whose scope depends on pending roadmap decisions.

Each worker should return a concise handoff: files inspected or changed, conclusions, unresolved questions, and any prototype or spec artifact paths.

## Experimental PM Automation

Use `scripts/roadmap/next-roadmap-actions.sh` to run a deterministic scan of the roadmap backlog.

The script reads each `docs/roadmap/<feature-slug>/` directory and writes `docs/roadmap/next-actions.md`. It does not build anything or dispatch agents. It emits separate "Next User Item" and "Next Agent Item" sections so user clarification can remain visible without blocking autonomous PM-assistant work. For each feature, deferred status wins first, then unresolved feedback, then open concerns, then blocked metadata or open questions, then review-document verdicts requesting rework; otherwise it chooses the first missing planning artifact as the likely next project-management action:

1. `status: deferred` -> deferred
2. unresolved `feedback/*.md` -> address-feedback
3. open `concerns.md` -> review-concerns
4. `status: blocked`, non-empty `blocked_by`, or `open-questions.md` -> blocked
5. `ux-review.md` with `verdict: needs-rework`/`rejected` -> `redirect_to` (default `build-prototypes`)
6. `architecture-review.md` with `verdict: needs-rework`/`rejected` -> `redirect_to` (default `write-architecture`)
7. `notes.md` -> clarify-feature
8. `user-stories.md` -> draft-user-stories
9. `existing-state.md` -> inspect-existing-state
10. `prototypes/*` -> build-prototypes
11. `ux-review.md` -> review-prototypes
12. `architecture.md` -> write-architecture
13. `architecture-review.md` -> review-architecture
14. `spec.md` -> write-spec
15. `plan.md` -> write-plan
16. `implementation-handoff.md` -> write-implementation-handoff
17. all present -> ready-for-build-queue

This is intentionally experimental. The selector should become more nuanced as the roadmap directories accumulate real notes, blocked states, user priorities, feedback, concerns, and prototype review outcomes.

Actions after `clarify-feature` are intended for `pm-assistant` unless the next action explicitly needs user input. `clarify-feature`, `blocked`, and `review-concerns` remain direct conversations with the user. `review-prototypes`, `review-architecture`, and `address-feedback` are PM-assistant actions.

### End-Of-Response Attention Check

Do not rely on the session-start hook as the main place to surface roadmap questions. It is easy to miss and not always aligned with the user's current focus.

At the end of PM roadmap responses, run or consult:

```bash
scripts/roadmap/attention-summary.sh
```

If it reports blocked items or open questions, include a short final note such as:

```text
Roadmap attention: 2 items need your input: item 7 Input Audio, item 13 Autoslice Algorithm.
```

Keep this note brief. It should alert the user without hijacking the response they asked for.

### Background Loop

The roadmap PM loop may be run by Claude or another background worker. Do not run multiple PM loops against the same branch at the same time.

Its contract:

- Operate only in `/Users/maxwilliams/dev/in-sequence`.
- Run `scripts/roadmap/next-roadmap-actions.sh` first.
- Execute exactly one item from the "Next Agent Item" section per wakeup.
- Use `pm-assistant` rules for PM work.
- Edit only `docs/roadmap/**`.
- Stop instead of guessing when no "Next Agent Item" exists or when the action requires user input, including `review-concerns`.
- Rerun `scripts/roadmap/next-roadmap-actions.sh` and `scripts/roadmap/attention-summary.sh` before reporting.
- Commit completed roadmap actions with `scripts/roadmap/commit-roadmap-action.sh`.
- Do not create a commit when the wakeup only refreshed `docs/roadmap/next-actions.md` or only discovered that user input is needed.

This automation is intentionally separate from the implementation/build loop.

### Roadmap Commit Discipline

The PM loop should leave a git trail when it successfully advances a roadmap item.

After a PM-assistant action writes or updates a roadmap artifact, run:

```bash
scripts/roadmap/commit-roadmap-action.sh
```

The helper stages and commits `docs/roadmap/**` only. It intentionally ignores pure `next-actions.md` churn so the 10-minute heartbeat does not create empty administrative commits.

Use manual commits for changes outside `docs/roadmap/**`, such as updates to the roadmap scripts, the PM assistant role, or this process document. Those are process changes rather than per-item PM action output.

## Roadmap Session Log

Use this section to keep a lightweight trail as the roadmap discussion proceeds.

Template:

```markdown
### <date> - <feature area>

- **Clarified problem:**
- **User stories drafted:**
- **Existing implementation inspected:**
- **Prototypes built:**
- **UX review result:**
- **Spec/build status:**
```
